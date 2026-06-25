import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  type KeyObject,
  sign as nodeSign,
} from "node:crypto";
import { test } from "node:test";

import {
  AP2_DATA_KEYS,
  AP2_EXTENSION_URI,
  ap2AgentCardExtension,
  canonicalize,
  type CartMandate,
  cartHash,
  cartMandateToIntent,
  cartTotal,
  gateAp2Cart,
  type IntentMandate,
  intentMandateToMandate,
  mandateToIntentMandate,
  type PaymentMandate,
  readAp2Mandates,
  toAp2DataPart,
  verifyCartMandate,
  verifyPaymentMandateBinding,
} from "../src/ap2/index.ts";
import { evaluateGate } from "../src/core/gate.ts";
import { DEFAULT_GATE_CONFIG } from "../src/core/types.ts";
import type { GateContext, Mandate } from "../src/core/types.ts";

// --- fixtures ----------------------------------------------------------------

function sampleMandate(over: Partial<Mandate> = {}): Mandate {
  return {
    id: "m_1",
    label: "weekly groceries",
    scope: { kind: "allowlist", values: ["acme-corp", "globex"] },
    currency: "USD",
    allowedRails: ["card"],
    perTxCap: 50_00,
    perPeriodCap: 200_00,
    period: "week",
    grantedAt: "2026-06-01T00:00:00.000Z",
    expiresAt: "2026-12-31T00:00:00.000Z",
    status: "active",
    ...over,
  };
}

function sampleCart(over: Partial<CartMandate["contents"]> = {}): CartMandate {
  return {
    contents: {
      id: "cart_1",
      user_cart_confirmation_required: true,
      merchant_name: "acme-corp",
      cart_expiry: "2026-12-31T00:00:00.000Z",
      payment_request: {
        method_data: [{ supported_methods: "basic-card" }],
        details: {
          id: "order_42",
          display_items: [{ label: "Widget", amount: { currency: "USD", value: 12.5 } }],
          total: { label: "Total", amount: { currency: "USD", value: 12.5 } },
        },
      },
      ...over,
    },
  };
}

function baseGateContext(over: Partial<GateContext> = {}): GateContext {
  return {
    now: "2026-06-15T00:00:00.000Z",
    mandates: [sampleMandate()],
    periodSpendByMandate: () => [],
    knownPayees: new Set(["acme-corp"]),
    denyRules: [],
    config: DEFAULT_GATE_CONFIG,
    ...over,
  };
}

// --- Mandate ⇄ IntentMandate -------------------------------------------------

test("mandateToIntentMandate maps allowlist scope to merchants and carries expiry", () => {
  const im = mandateToIntentMandate(sampleMandate());
  assert.equal(im.natural_language_description, "weekly groceries");
  assert.deepEqual(im.merchants, ["acme-corp", "globex"]);
  assert.equal(im.intent_expiry, "2026-12-31T00:00:00.000Z");
  assert.equal(im.user_cart_confirmation_required, true);
  assert.equal(im.requires_refundability, false);
});

test("mandateToIntentMandate maps class scope to null merchants", () => {
  const im = mandateToIntentMandate(sampleMandate({ scope: { kind: "class", value: "groceries" } }));
  assert.equal(im.merchants, null);
});

test("intentMandateToMandate restores allowlist scope and expiry; caps from opts", () => {
  const im = mandateToIntentMandate(sampleMandate());
  const m = intentMandateToMandate(im, {
    id: "m_2",
    currency: "USD",
    allowedRails: ["card"],
    perTxCap: 50_00,
    perPeriodCap: 200_00,
    period: "week",
    grantedAt: "2026-06-01T00:00:00.000Z",
  });
  assert.deepEqual(m.scope, { kind: "allowlist", values: ["acme-corp", "globex"] });
  assert.equal(m.expiresAt, "2026-12-31T00:00:00.000Z");
  assert.equal(m.perTxCap, 50_00);
  assert.equal(m.status, "active");
});

test("intentMandateToMandate with no merchants falls back to class scope", () => {
  const im: IntentMandate = {
    user_cart_confirmation_required: true,
    natural_language_description: "anything",
    merchants: null,
    intent_expiry: "2026-12-31T00:00:00.000Z",
  };
  const m = intentMandateToMandate(im, {
    id: "m_3",
    currency: "USD",
    allowedRails: ["card"],
    perTxCap: 1000,
    perPeriodCap: 5000,
    period: "day",
    grantedAt: "2026-06-01T00:00:00.000Z",
    payeeClass: "shopping",
  });
  assert.deepEqual(m.scope, { kind: "class", value: "shopping" });
});

// --- CartMandate → PaymentIntent ---------------------------------------------

test("cartTotal converts major units to integer minor-units (default 100)", () => {
  assert.deepEqual(cartTotal(sampleCart()), { amount: 1250, currency: "USD" });
});

test("cartTotal honors injectable minorUnitsPerMajor", () => {
  const jpy = sampleCart({
    payment_request: {
      method_data: [{ supported_methods: "basic-card" }],
      details: {
        id: "o",
        display_items: [],
        total: { label: "Total", amount: { currency: "JPY", value: 500 } },
      },
    },
  });
  assert.deepEqual(cartTotal(jpy, 1), { amount: 500, currency: "JPY" });
});

test("cartMandateToIntent extracts payee, minor-units amount, currency", () => {
  const intent = cartMandateToIntent(sampleCart(), {
    id: "pi_1",
    payeeClass: "groceries",
    rail: "card",
    rationale: "weekly grocery run",
    createdAt: "2026-06-15T00:00:00.000Z",
  });
  assert.equal(intent.payee, "acme-corp");
  assert.equal(intent.amount, 1250);
  assert.equal(intent.currency, "USD");
  assert.equal(intent.rail, "card");
});

// --- Gate seam ---------------------------------------------------------------

test("gateAp2Cart returns the SAME decision as the equivalent hand-built intent", () => {
  const cart = sampleCart();
  const opts = {
    id: "pi_g",
    payeeClass: "acme-corp",
    rail: "card" as const,
    rationale: "covered grocery run",
    createdAt: "2026-06-15T00:00:00.000Z",
  };
  const ctx = baseGateContext();
  const { intent, decision } = gateAp2Cart({}, cart, ctx, opts);

  const handBuilt = evaluateGate(intent, ctx);
  assert.deepEqual(decision, handBuilt);
  assert.equal(decision.outcome, "auto_execute");
});

test("gateAp2Cart over perTxCap blocks (gate's existing cap semantics)", () => {
  const cart = sampleCart({
    payment_request: {
      method_data: [{ supported_methods: "basic-card" }],
      details: {
        id: "o",
        display_items: [],
        total: { label: "Total", amount: { currency: "USD", value: 75.0 } },
      },
    },
  });
  const { decision } = gateAp2Cart({}, cart, baseGateContext(), {
    id: "pi_big",
    payeeClass: "acme-corp",
    rail: "card",
    rationale: "expensive grocery run",
    createdAt: "2026-06-15T00:00:00.000Z",
  });
  assert.equal(decision.outcome, "block");
  assert.match(decision.reasons[0], /per-transaction cap/);
});

test("gateAp2Cart with no covering mandate routes to operator", () => {
  const cart = sampleCart({ merchant_name: "unknown-merchant" });
  const { decision } = gateAp2Cart({}, cart, baseGateContext(), {
    id: "pi_unk",
    payeeClass: "unknown-merchant",
    rail: "card",
    rationale: "novel merchant purchase",
    createdAt: "2026-06-15T00:00:00.000Z",
  });
  assert.equal(decision.outcome, "confirm_operator");
});

// --- verifyCartMandate (real ed25519 JWT) ------------------------------------

interface KeyPair {
  publicKey: KeyObject;
  privateKey: KeyObject;
}

function ed25519Pair(): KeyPair {
  return generateKeyPairSync("ed25519");
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function signEdDsaJwt(
  claims: Record<string, unknown>,
  privateKey: KeyObject,
  kid = "merchant-key-1",
): string {
  const header = { alg: "EdDSA", typ: "JWT", kid };
  const headerB64 = b64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = b64url(Buffer.from(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = nodeSign(null, Buffer.from(signingInput, "utf8"), privateKey);
  return `${signingInput}.${b64url(sig)}`;
}

function signedCart(privateKey: KeyObject, claimsOver: Record<string, unknown> = {}): CartMandate {
  const cart = sampleCart();
  const claims = {
    iss: "https://acme.example",
    sub: "acme-corp",
    aud: "shopper-agent",
    iat: 1_750_000_000,
    exp: 1_760_000_000,
    jti: "jti-1",
    cart_hash: cartHash(cart.contents),
    ...claimsOver,
  };
  cart.merchant_authorization = signEdDsaJwt(claims, privateKey);
  return cart;
}

const FIXED_NOW = () => 1_755_000_000_000; // ms, between iat and exp above

test("verifyCartMandate: valid signature + matching cart_hash → ok", async () => {
  const { publicKey, privateKey } = ed25519Pair();
  const cart = signedCart(privateKey);
  const res = await verifyCartMandate(cart, { resolveKey: () => publicKey, now: FIXED_NOW });
  assert.equal(res.ok, true);
  assert.equal(res.cartHashOk, true);
  assert.equal(res.claims?.iss, "https://acme.example");
});

test("verifyCartMandate: tampered content → cart_hash mismatch, not ok", async () => {
  const { publicKey, privateKey } = ed25519Pair();
  const cart = signedCart(privateKey);
  cart.contents.merchant_name = "evil-corp";
  const res = await verifyCartMandate(cart, { resolveKey: () => publicKey, now: FIXED_NOW });
  assert.equal(res.cartHashOk, false);
  assert.equal(res.ok, false);
});

test("verifyCartMandate: wrong key → signature does not verify", async () => {
  const { privateKey } = ed25519Pair();
  const { publicKey: otherPub } = ed25519Pair();
  const cart = signedCart(privateKey);
  const res = await verifyCartMandate(cart, { resolveKey: () => otherPub, now: FIXED_NOW });
  assert.equal(res.ok, false);
  assert.match(res.reason ?? "", /signature did not verify/);
});

test("verifyCartMandate: expired exp → not ok", async () => {
  const { publicKey, privateKey } = ed25519Pair();
  const cart = signedCart(privateKey, { exp: 1_700_000_000 });
  const res = await verifyCartMandate(cart, { resolveKey: () => publicKey, now: FIXED_NOW });
  assert.equal(res.ok, false);
  assert.match(res.reason ?? "", /expired/);
});

test("verifyCartMandate: unsigned cart → not ok", async () => {
  const cart = sampleCart();
  cart.merchant_authorization = null;
  const res = await verifyCartMandate(cart, { resolveKey: () => undefined });
  assert.equal(res.ok, false);
  assert.equal(res.cartHashOk, false);
  assert.match(res.reason ?? "", /unsigned/);
});

// --- verifyPaymentMandateBinding ---------------------------------------------

function paymentMandateFor(
  cart: CartMandate,
  over: { detailsId?: string; includeCartHash?: boolean; includePmcHash?: boolean } = {},
): PaymentMandate {
  const pmc = {
    payment_mandate_id: "pm_1",
    payment_details_id: over.detailsId ?? cart.contents.payment_request.details.id,
    payment_details_total: cart.contents.payment_request.details.total,
    payment_response: { method_name: "basic-card" },
    merchant_agent: "acme-corp",
    timestamp: "2026-06-15T00:00:00.000Z",
  };
  const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
  const td: string[] = [];
  if (over.includeCartHash !== false) td.push(sha(canonicalize(cart)));
  if (over.includePmcHash !== false) td.push(sha(canonicalize(pmc)));

  const kbPayload = b64url(Buffer.from(JSON.stringify({ transaction_data: td })));
  const kbJwt = `${b64url(Buffer.from('{"alg":"none"}'))}.${kbPayload}.`;
  const userAuth = `issuer-jwt~disclosure~${kbJwt}`;

  return { payment_mandate_contents: pmc, user_authorization: userAuth };
}

test("verifyPaymentMandateBinding: matching id + both hashes → ok", () => {
  const cart = sampleCart();
  const pm = paymentMandateFor(cart);
  assert.equal(verifyPaymentMandateBinding(pm, cart).ok, true);
});

test("verifyPaymentMandateBinding: mismatched details id → not ok", () => {
  const cart = sampleCart();
  const pm = paymentMandateFor(cart, { detailsId: "other_order" });
  const res = verifyPaymentMandateBinding(pm, cart);
  assert.equal(res.ok, false);
  assert.match(res.reason ?? "", /payment_details_id/);
});

test("verifyPaymentMandateBinding: missing cart hash → not ok", () => {
  const cart = sampleCart();
  const pm = paymentMandateFor(cart, { includeCartHash: false });
  const res = verifyPaymentMandateBinding(pm, cart);
  assert.equal(res.ok, false);
  assert.match(res.reason ?? "", /CartMandate hash/);
});

// --- A2A tie-in --------------------------------------------------------------

test("ap2AgentCardExtension has the AP2 uri and the requested roles", () => {
  const ext = ap2AgentCardExtension(["merchant", "payment-processor"], { required: true });
  assert.equal(ext.uri, AP2_EXTENSION_URI);
  assert.equal(ext.required, true);
  assert.deepEqual(ext.params.roles, ["merchant", "payment-processor"]);
});

test("DataPart pack/unpack round-trips by the AP2 keys", () => {
  const im = mandateToIntentMandate(sampleMandate());
  const cart = sampleCart();
  const intentPart = toAp2DataPart("intent", im);
  const cartPart = toAp2DataPart("cart", cart);
  assert.ok(intentPart.data[AP2_DATA_KEYS.intent]);
  assert.ok(cartPart.data[AP2_DATA_KEYS.cart]);

  const read = readAp2Mandates({ parts: [intentPart, cartPart] });
  assert.deepEqual(read.intent, im);
  assert.deepEqual(read.cart, cart);
  assert.equal(read.payment, undefined);
});
