import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cdpSpendToIntent,
  governedWallet,
  type WalletSpendRequest,
} from "../src/rails/governedWallet.ts";
import { DEFAULT_DENY_RULES } from "../src/core/denyList.ts";
import {
  DEFAULT_GATE_CONFIG,
  type DenyRule,
  type GateContext,
  type Mandate,
} from "../src/core/types.ts";

const NOW = "2026-05-29T12:00:00.000Z";

// A live mandate covering USDC wallet spends to a "saas" class on the onchain rail.
function saasMandate(over: Partial<Mandate> = {}): Mandate {
  return {
    id: "m_saas",
    label: "agent saas spend",
    scope: { kind: "class", value: "saas" },
    currency: "USDC",
    allowedRails: ["onchain"],
    perTxCap: 100_00, // 100.00 USDC
    perPeriodCap: 500_00,
    period: "week",
    grantedAt: "2026-05-26T00:00:00.000Z",
    expiresAt: "2026-06-26T00:00:00.000Z",
    status: "active",
    ...over,
  };
}

function ctx(over: Partial<GateContext> = {}): GateContext {
  return {
    now: NOW,
    mandates: [saasMandate()],
    periodSpendByMandate: () => [],
    // known payee so the irreversible-to-unknown deny rule + new-payee confirm don't fire
    knownPayees: new Set(["0xVendor"]),
    denyRules: DEFAULT_DENY_RULES,
    config: DEFAULT_GATE_CONFIG,
    ...over,
  };
}

function spendReq(over: Partial<WalletSpendRequest> = {}): WalletSpendRequest {
  return {
    wallet: "0xAgentWallet",
    to: "0xVendor",
    amount: 40_00, // 40.00 USDC, under the 100.00 per-tx cap
    token: "USDC",
    network: "base",
    payeeClass: "saas",
    rationale: "monthly inference credits top-up",
    ...over,
  };
}

test("cdpSpendToIntent maps a structural wallet spend onto a PaymentIntent", () => {
  const intent = cdpSpendToIntent(spendReq(), { now: NOW });
  assert.equal(intent.payee, "0xVendor");
  assert.equal(intent.payeeClass, "saas");
  assert.equal(intent.amount, 40_00);
  assert.equal(intent.currency, "USDC");
  assert.equal(intent.rail, "onchain"); // a wallet send is irreversible by default
  assert.equal(intent.createdAt, NOW);
  assert.equal(intent.rationale, "monthly inference credits top-up");
});

test("cdpSpendToIntent: payeeClass defaults to network, payee to `to`, currency from token", () => {
  const intent = cdpSpendToIntent(
    { wallet: "0xW", to: "0xRecv", amount: 1_00, token: "ETH", network: "ethereum" },
    { now: NOW },
  );
  assert.equal(intent.payee, "0xRecv");
  assert.equal(intent.payeeClass, "ethereum");
  assert.equal(intent.currency, "ETH");
});

test("cdpSpendToIntent throws on a spend with no token/currency", () => {
  assert.throws(
    () => cdpSpendToIntent({ wallet: "0xW", to: "0xR", amount: 1 } as WalletSpendRequest, { now: NOW }),
    /token\/currency/,
  );
});

// 1. Covered spend → auto_execute AND the injected seam runs exactly once, right args.
test("covered spend → auto_execute and the injected execute seam runs once", async () => {
  const calls: Array<{ to: string; amount: number; intentId: string }> = [];
  const wallet = governedWallet({
    gate: ctx(),
    now: () => NOW,
    execute: (req, intent) => {
      calls.push({ to: req.to, amount: req.amount, intentId: intent.id });
      return { ref: "0xTXHASH" };
    },
  });

  const res = await wallet.spend(spendReq());

  assert.equal(res.decision.outcome, "auto_execute");
  assert.equal(res.decision.mandateId, "m_saas");
  assert.equal(res.executed, true);
  assert.deepEqual(res.receipt, { ref: "0xTXHASH" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, "0xVendor");
  assert.equal(calls[0].amount, 40_00);
  assert.equal(calls[0].intentId, res.intent.id);
});

// 2. Over the per-tx cap → blocked, the seam is NEVER called, money does not move.
test("over per-tx cap → block and the execute seam is NOT called", async () => {
  let called = 0;
  const wallet = governedWallet({
    gate: ctx(),
    now: () => NOW,
    execute: () => {
      called++;
      return { ref: "should-not-happen" };
    },
  });

  const res = await wallet.spend(spendReq({ amount: 200_00 })); // > 100.00 per-tx cap

  assert.equal(res.decision.outcome, "block");
  assert.ok(res.decision.reasons.some((r) => r.includes("per-transaction cap")));
  assert.equal(res.executed, false);
  assert.equal(res.receipt, null);
  assert.equal(called, 0);
});

// 3. Deny-listed payee → block (deny-list is structural, unconditional), seam never runs.
test("deny-listed payee → block and the execute seam is NOT called", async () => {
  let called = 0;
  const denyVendor: DenyRule = {
    id: "blocked_payee",
    reason: "payee is on the operator deny-list",
    match: (intent) => intent.payee === "0xVendor",
  };
  const wallet = governedWallet({
    gate: ctx({ denyRules: [...DEFAULT_DENY_RULES, denyVendor] }),
    now: () => NOW,
    execute: () => {
      called++;
      return { ref: "should-not-happen" };
    },
  });

  const res = await wallet.spend(spendReq());

  assert.equal(res.decision.outcome, "block");
  assert.ok(res.decision.reasons.some((r) => r.includes("deny-list")));
  assert.equal(res.executed, false);
  assert.equal(called, 0);
});

// 4. No covering mandate → confirm_operator (route to human), seam never runs.
test("no covering mandate → confirm_operator and the execute seam is NOT called", async () => {
  let called = 0;
  const wallet = governedWallet({
    gate: ctx({ mandates: [] }),
    now: () => NOW,
    execute: () => {
      called++;
      return { ref: "should-not-happen" };
    },
  });

  const res = await wallet.spend(spendReq());

  assert.equal(res.decision.outcome, "confirm_operator");
  assert.equal(res.executed, false);
  assert.equal(called, 0);
});

// The gate context may be a per-spend thunk so spend history can advance between calls.
test("accepts a per-spend gate-context builder (thunk)", async () => {
  let built = 0;
  const wallet = governedWallet({
    gate: () => {
      built++;
      return ctx();
    },
    now: () => NOW,
    execute: () => ({ ref: "0xTX" }),
  });

  const res = await wallet.spend(spendReq());
  assert.equal(built, 1);
  assert.equal(res.executed, true);
});
