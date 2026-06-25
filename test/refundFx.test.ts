import { test } from "node:test";
import assert from "node:assert/strict";

import { AuditLog } from "../src/core/audit.ts";
import { createExecutor } from "../src/core/executor.ts";
import { createMemoryStore } from "../src/store/memoryStore.ts";
import { createRailRegistry } from "../src/rails/registry.ts";
import { createFakeRail } from "../src/rails/fakeRail.ts";
import { DEFAULT_DENY_RULES } from "../src/core/denyList.ts";
import { DEFAULT_GATE_CONFIG, type Mandate, type PaymentIntent } from "../src/core/types.ts";
import { evaluateGate } from "../src/core/gate.ts";
import {
  convertMinor,
  convertMinorCrossDecimal,
  convertMinorCrossDecimalDinero,
  minorUnitExponent,
  fixedRateSource,
} from "../src/core/fx.ts";
import type { Store } from "../src/core/store.ts";

const NOW = "2026-05-30T12:00:00.000Z";

function cardHarness() {
  const store: Store = createMemoryStore("k");
  store.insertMandate({
    id: "m",
    label: "groceries",
    scope: { kind: "class", value: "groceries" },
    currency: "GBP",
    allowedRails: ["card"],
    perTxCap: 500_00,
    perPeriodCap: 1000_00,
    period: "week",
    grantedAt: "2026-05-26T00:00:00.000Z",
    expiresAt: "2026-06-26T00:00:00.000Z",
    status: "active",
  } satisfies Mandate);
  // seed tesco known so it auto-settles
  store.insertIntent({
    intent: {
      id: "seed",
      payee: "tesco",
      payeeClass: "groceries",
      amount: 80_00,
      currency: "GBP",
      rail: "card",
      rationale: "seed",
      createdAt: NOW,
    },
    status: "settled",
    mandateId: "m",
    reasons: [],
    settledAt: "2026-05-26T09:00:00.000Z",
    receiptId: "rseed",
  });
  const executor = createExecutor({
    store,
    rails: createRailRegistry([createFakeRail("card")]),
    audit: new AuditLog(store.operatorKey()),
    config: DEFAULT_GATE_CONFIG,
    denyRules: DEFAULT_DENY_RULES,
    clock: () => NOW,
  });
  return { store, executor };
}

const tesco = (over: Partial<PaymentIntent> = {}): PaymentIntent => ({
  id: "pi",
  payee: "tesco",
  payeeClass: "groceries",
  amount: 80_00,
  currency: "GBP",
  rail: "card",
  rationale: "weekly shop",
  createdAt: NOW,
  ...over,
});

// --- refunds ---
test("a reversible payment can be refunded and frees the budget", async () => {
  const { store, executor } = cardHarness();
  const settled = await executor.execute(tesco({ id: "pi_r" }));
  assert.equal(settled.status, "settled");

  const refund = await executor.refund("pi_r");
  assert.equal(refund.ok, true);
  assert.equal(refund.refundedMinor, 80_00);
  assert.equal(store.getIntent("pi_r")?.refundedMinor, 80_00);
  // period spend now nets the refund (pi_r contributes 0).
  assert.equal(
    store.periodSpend("m", NOW).reduce((s, p) => s + p.amount, 0),
    80_00, // only the seed remains
  );
});

test("an irreversible (on-chain) settlement cannot be refunded", async () => {
  const store = createMemoryStore("k");
  store.insertMandate({
    id: "m",
    label: "saas",
    scope: { kind: "class", value: "saas" },
    currency: "USDC",
    allowedRails: ["onchain"],
    perTxCap: 5_000,
    perPeriodCap: 50_000,
    period: "month",
    grantedAt: "2026-05-01T00:00:00.000Z",
    expiresAt: "2026-12-01T00:00:00.000Z",
    status: "active",
  } satisfies Mandate);
  store.insertIntent({
    intent: { id: "seed", payee: "alice", payeeClass: "saas", amount: 1000, currency: "USDC", rail: "onchain", rationale: "s", createdAt: NOW },
    status: "settled",
    mandateId: "m",
    reasons: [],
    settledAt: "2026-05-02T00:00:00.000Z",
    receiptId: "r",
  });
  const executor = createExecutor({
    store,
    rails: createRailRegistry([createFakeRail("onchain")]),
    audit: new AuditLog(store.operatorKey()),
    config: DEFAULT_GATE_CONFIG,
    denyRules: DEFAULT_DENY_RULES,
    clock: () => NOW,
  });
  const settled = await executor.execute({
    id: "pi_oc",
    payee: "alice",
    payeeClass: "saas",
    amount: 1000,
    currency: "USDC",
    rail: "onchain",
    rationale: "renew subscription",
    createdAt: NOW,
  });
  assert.equal(settled.status, "settled");
  const refund = await executor.refund("pi_oc");
  assert.equal(refund.ok, false);
  assert.match(refund.reason ?? "", /irreversible/);
});

// --- mandate lifecycle ---
test("a mandate can be amended and extended", () => {
  const { store, executor } = cardHarness();
  executor.amendMandate("m", { perTxCap: 999_00 });
  assert.equal(store.getMandate("m")?.perTxCap, 999_00);
  executor.extendMandate("m", "2027-01-01T00:00:00.000Z");
  assert.equal(store.getMandate("m")?.expiresAt, "2027-01-01T00:00:00.000Z");
});

// --- FX / multi-currency ---
test("convertMinor converts at a rate", () => {
  assert.equal(convertMinor(100_00, 0.8), 80_00);
});

// --- cross-decimal FX (JPY 0-decimal) ---
test("minorUnitExponent knows the non-2-decimal currencies", () => {
  assert.equal(minorUnitExponent("GBP"), 2);
  assert.equal(minorUnitExponent("USD"), 2);
  assert.equal(minorUnitExponent("JPY"), 0);
  assert.equal(minorUnitExponent("jpy"), 0); // case-insensitive
  assert.equal(minorUnitExponent("BHD"), 3);
  assert.equal(minorUnitExponent("XYZ"), 2); // default
});

test("convertMinorCrossDecimal sizes a JPY→GBP cap correctly (the shared-scale bug)", () => {
  // ¥10,000 (JPY has 0 decimals → 10000 minor units) at 0.0053 GBP/JPY = £53.00.
  // The naive shared-scale convertMinor mis-sizes it 100× (→ 53 pence).
  assert.equal(convertMinor(10_000, 0.0053), 53); // buggy: treats ¥ as pence
  assert.equal(convertMinorCrossDecimal(10_000, 0.0053, "JPY", "GBP"), 53_00); // £53.00
});

test("convertMinorCrossDecimal is symmetric back to JPY", () => {
  // £53.00 = 5300 pence at 188.68 JPY/GBP → ¥10,000 (10000 minor units, 0 decimals).
  assert.equal(convertMinorCrossDecimal(53_00, 188.68, "GBP", "JPY"), 10_000);
});

test("convertMinorCrossDecimal equals convertMinor for same-decimal pairs", () => {
  assert.equal(convertMinorCrossDecimal(100_00, 0.8, "USD", "GBP"), convertMinor(100_00, 0.8));
});

test("the dinero-backed adapter falls back to the dep-free result when absent", async () => {
  // dinero.js is an optionalDependency (not installed in CI) → identical result.
  const viaAdapter = await convertMinorCrossDecimalDinero(10_000, 0.0053, "JPY", "GBP");
  assert.equal(viaAdapter, convertMinorCrossDecimal(10_000, 0.0053, "JPY", "GBP"));
  assert.equal(viaAdapter, 53_00);
});

test("a foreign-currency payment is capped in the mandate's currency", () => {
  const mandate: Mandate = {
    id: "m",
    label: "travel",
    scope: { kind: "class", value: "travel" },
    currency: "GBP",
    allowedRails: ["card"],
    perTxCap: 100_00, // £100
    perPeriodCap: 1000_00,
    period: "month",
    grantedAt: "2026-05-01T00:00:00.000Z",
    expiresAt: "2026-12-01T00:00:00.000Z",
    status: "active",
  };
  const fx = fixedRateSource({ "USD/GBP": 0.8 });
  const convert = (a: number, from: string, to: string) => {
    const r = fx.rate(from, to);
    return r === undefined ? undefined : convertMinor(a, r);
  };
  const ctx = (over = {}) => ({
    now: NOW,
    mandates: [mandate],
    periodSpendByMandate: () => [],
    knownPayees: new Set(["expedia"]),
    denyRules: DEFAULT_DENY_RULES,
    config: DEFAULT_GATE_CONFIG,
    convert,
    ...over,
  });
  const usd = (amount: number): PaymentIntent => ({
    id: "pi",
    payee: "expedia",
    payeeClass: "travel",
    amount,
    currency: "USD",
    rail: "card",
    rationale: "hotel booking",
    createdAt: NOW,
  });

  // $120 → £96, under the £100 cap → auto-execute (known payee).
  assert.equal(evaluateGate(usd(120_00), ctx()).outcome, "auto_execute");
  // $150 → £120, over the £100 cap → block.
  assert.equal(evaluateGate(usd(150_00), ctx()).outcome, "block");
  // No rate available → mandate doesn't cover → operator confirmation.
  assert.equal(
    evaluateGate(usd(120_00), ctx({ convert: () => undefined })).outcome,
    "confirm_operator",
  );
});
