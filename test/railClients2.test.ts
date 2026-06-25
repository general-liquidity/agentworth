import { test } from "node:test";
import assert from "node:assert/strict";

import { AuditLog } from "../src/core/audit.ts";
import { createExecutor } from "../src/core/executor.ts";
import { createMemoryStore } from "../src/store/memoryStore.ts";
import { createRailRegistry } from "../src/rails/registry.ts";
import { createVisaIntelligentCommerceRail } from "../src/rails/visaIntelligentCommerce.ts";
import { createX402Rail } from "../src/rails/x402.ts";
import {
  createVirtualCardRailClient,
  type CardIssuer,
  type IssuedCard,
} from "../src/rails/clients/virtualCardClient.ts";
import {
  createX402RailClient,
  decodePaymentHeader,
  encodePaymentHeader,
  X402_VERSION,
  type PaymentRequirements,
  type X402Facilitator,
  type X402PaymentPayload,
} from "../src/rails/clients/x402Client.ts";
import { DEFAULT_DENY_RULES } from "../src/core/denyList.ts";
import { DEFAULT_GATE_CONFIG, type Mandate, type PaymentIntent } from "../src/core/types.ts";

const NOW = "2026-05-30T12:00:00.000Z";

// ---------------- #3: single-use virtual card ----------------

function mockIssuer() {
  const minted: Array<{ spendLimitMinor: number; merchant?: string; reference: string }> = [];
  let n = 0;
  const issuer: CardIssuer = {
    createCard(args): IssuedCard {
      minted.push({
        spendLimitMinor: args.spendLimitMinor,
        merchant: args.merchant,
        reference: args.reference,
      });
      return { cardId: `ic_${n++}`, spendLimitMinor: args.spendLimitMinor };
    },
  };
  return { issuer, minted };
}

const cardIntent = (over: Partial<PaymentIntent> = {}): PaymentIntent => ({
  id: "pi_card",
  payee: "openai",
  payeeClass: "saas",
  amount: 20_00,
  currency: "USD",
  rail: "card",
  rationale: "api credits topup",
  createdAt: NOW,
  ...over,
});

test("the card client mints a single-use card capped at exactly the intent amount", async () => {
  const { issuer, minted } = mockIssuer();
  const client = createVirtualCardRailClient({
    issuer,
    resolveMerchant: (p) => (p === "openai" ? "OPENAI*API" : undefined),
  });
  const s = await client.settle(cardIntent());
  assert.equal(s.providerRef, "ic_0");
  assert.equal(s.finality, "reversible"); // card ⇒ chargeback-able
  assert.equal(minted.length, 1);
  assert.equal(minted[0].spendLimitMinor, 20_00); // pinned to the intent amount
  assert.equal(minted[0].merchant, "OPENAI*API");
});

test("a fresh card is minted per intent (single-use)", async () => {
  const { issuer, minted } = mockIssuer();
  const client = createVirtualCardRailClient({ issuer });
  const a = await client.settle(cardIntent({ id: "a" }));
  const b = await client.settle(cardIntent({ id: "b" }));
  assert.notEqual(a.providerRef, b.providerRef);
  assert.deepEqual(
    minted.map((m) => m.reference),
    ["a", "b"],
  );
});

test("end-to-end: the card client settles through a Visa rail and reads back", async () => {
  const { issuer } = mockIssuer();
  const store = createMemoryStore("k");
  store.insertMandate({
    id: "m_saas",
    label: "saas",
    scope: { kind: "class", value: "saas" },
    currency: "USD",
    allowedRails: ["card"],
    perTxCap: 100_00,
    perPeriodCap: 500_00,
    period: "month",
    grantedAt: "2026-05-01T00:00:00.000Z",
    expiresAt: "2026-12-01T00:00:00.000Z",
    status: "active",
  } satisfies Mandate);
  store.insertIntent({
    intent: cardIntent({ id: "seed" }),
    status: "settled",
    mandateId: "m_saas",
    reasons: [],
    settledAt: "2026-05-02T00:00:00.000Z",
    receiptId: "r",
  });
  const rails = createRailRegistry([
    createVisaIntelligentCommerceRail(createVirtualCardRailClient({ issuer })),
  ]);
  const executor = createExecutor({
    store,
    rails,
    audit: new AuditLog(store.operatorKey()),
    config: DEFAULT_GATE_CONFIG,
    denyRules: DEFAULT_DENY_RULES,
    clock: () => NOW,
  });
  const r = await executor.execute(cardIntent({ id: "pi_live" }));
  assert.equal(r.status, "settled");
  assert.equal(r.receipt?.providerRef, "ic_0");
  assert.equal(r.verified, true);
});

// ---------------- #4: x402 protocol flow ----------------

function mockFacilitator() {
  const settled: Array<{ network: string; amountMinor: number }> = [];
  const facilitator: X402Facilitator = {
    authorize(args) {
      return `xpay:${args.requirement.network}:${args.amountMinor}:${args.reference}`;
    },
    settle(args) {
      const amountMinor = Number(args.paymentHeader.split(":")[2]);
      settled.push({ network: args.requirement.network, amountMinor });
      return { txRef: `0xtx_${args.requirement.network}`, network: args.requirement.network };
    },
  };
  return { facilitator, settled };
}

const REQS = (over: Partial<PaymentRequirements> = {}): PaymentRequirements => ({
  scheme: "exact",
  network: "base",
  asset: "0xUSDC",
  payTo: "0xmerchant",
  maxAmountRequired: "1000000", // 1 USDC
  ...over,
});

const x402Intent = (over: Partial<PaymentIntent> = {}): PaymentIntent => ({
  id: "pi_x402",
  payee: "exa",
  payeeClass: "saas",
  amount: 500_000, // 0.5 USDC
  currency: "USDC",
  rail: "onchain",
  rationale: "metered search query",
  createdAt: NOW,
  ...over,
});

test("the x402 client selects an affordable requirement, authorizes, and settles", async () => {
  const { facilitator, settled } = mockFacilitator();
  const client = createX402RailClient({
    facilitator,
    quote: () => [REQS({ network: "solana" }), REQS({ network: "base" })],
    networks: ["base"], // wallet only pays on base
  });
  const s = await client.settle(x402Intent());
  assert.equal(s.providerRef, "0xtx_base");
  assert.equal(s.finality, "final"); // on-chain ⇒ irreversible
  assert.equal(settled.length, 1);
  assert.equal(settled[0].network, "base");
  assert.equal(settled[0].amountMinor, 500_000);
});

test("the x402 client refuses when no requirement is affordable or on an allowed network", async () => {
  const { facilitator } = mockFacilitator();
  const overPriced = createX402RailClient({
    facilitator,
    quote: () => [REQS({ maxAmountRequired: "100000" })], // 0.1 USDC < 0.5 needed
  });
  await assert.rejects(() => Promise.resolve(overPriced.settle(x402Intent())));

  const wrongNetwork = createX402RailClient({
    facilitator,
    quote: () => [REQS({ network: "solana" })],
    networks: ["base"],
  });
  await assert.rejects(() => Promise.resolve(wrongNetwork.settle(x402Intent())));
});

test("the X-PAYMENT header codec round-trips the V1 structured payload", () => {
  const payload: X402PaymentPayload = {
    x402Version: X402_VERSION,
    scheme: "exact",
    network: "base",
    payload: {
      signature: "0xsig",
      authorization: {
        from: "0xfrom",
        to: "0xmerchant",
        value: "500000",
        validAfter: "0",
        validBefore: "1734567890",
        nonce: "0xnonce",
      },
    },
  };
  const header = encodePaymentHeader(payload);
  assert.equal(Buffer.from(header, "base64").toString("utf8").length > 0, true);
  assert.deepEqual(decodePaymentHeader(header), payload);
});

test("the x402 client refuses when the facilitator reports settlement failure", async () => {
  const facilitator: X402Facilitator = {
    authorize: (a) => `xpay:${a.amountMinor}`,
    settle: (a) => ({ txRef: "0xfail", network: a.requirement.network, success: false }),
  };
  const client = createX402RailClient({ facilitator, quote: () => [REQS()] });
  await assert.rejects(
    () => Promise.resolve(client.settle(x402Intent())),
    /settlement failure/,
  );
});

test("end-to-end: the x402 client settles through the onchain rail and reads back", async () => {
  const { facilitator } = mockFacilitator();
  const store = createMemoryStore("k");
  store.insertMandate({
    id: "m_saas",
    label: "saas",
    scope: { kind: "class", value: "saas" },
    currency: "USDC",
    allowedRails: ["onchain"],
    perTxCap: 5_000_000,
    perPeriodCap: 20_000_000,
    period: "month",
    grantedAt: "2026-05-01T00:00:00.000Z",
    expiresAt: "2026-12-01T00:00:00.000Z",
    status: "active",
  } satisfies Mandate);
  store.insertIntent({
    intent: x402Intent({ id: "seed" }),
    status: "settled",
    mandateId: "m_saas",
    reasons: [],
    settledAt: "2026-05-02T00:00:00.000Z",
    receiptId: "r",
  });
  const rails = createRailRegistry([
    createX402Rail(
      createX402RailClient({ facilitator, quote: () => [REQS({ maxAmountRequired: "5000000" })] }),
    ),
  ]);
  const executor = createExecutor({
    store,
    rails,
    audit: new AuditLog(store.operatorKey()),
    config: DEFAULT_GATE_CONFIG,
    denyRules: DEFAULT_DENY_RULES,
    clock: () => NOW,
  });
  const r = await executor.execute(x402Intent({ id: "pi_live" }));
  assert.equal(r.status, "settled");
  assert.equal(r.receipt?.providerRef, "0xtx_base");
  assert.equal(r.verified, true);
});
