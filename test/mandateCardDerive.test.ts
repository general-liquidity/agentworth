import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSpendCard, lintSpendCard, type SpendMandateCard } from "../src/core/mandateCard.ts";
import type { PaymentIntent } from "../src/core/types.ts";

function pay(over: Partial<PaymentIntent>): PaymentIntent {
  return {
    id: over.id ?? "i",
    payee: over.payee ?? "store",
    payeeClass: over.payeeClass ?? "groceries",
    amount: over.amount ?? 10_00,
    currency: over.currency ?? "GBP",
    rail: over.rail ?? "card",
    rationale: over.rationale ?? "weekly shop",
    createdAt: over.createdAt ?? "2026-05-01T00:00:00Z",
  };
}

test("deriveSpendCard infers least-privilege caps and the rails actually used", () => {
  const history: PaymentIntent[] = [
    pay({ id: "1", payeeClass: "groceries", amount: 20_00, rail: "card", createdAt: "2026-05-01T00:00:00Z" }),
    pay({ id: "2", payeeClass: "groceries", amount: 35_00, rail: "card", createdAt: "2026-05-08T00:00:00Z" }),
    pay({ id: "3", payeeClass: "groceries", amount: 15_00, rail: "checkout", createdAt: "2026-05-15T00:00:00Z" }),
    // separate class + currency group
    pay({ id: "4", payeeClass: "saas", amount: 9_00, currency: "USD", rail: "card", createdAt: "2026-05-02T00:00:00Z" }),
  ];

  const card = deriveSpendCard(history, { agentId: "shopper", period: "month" });

  assert.equal(card.agentId, "shopper");
  assert.equal(card.requiredMandates.length, 2);

  const groceries = card.requiredMandates.find((r) => r.class === "groceries")!;
  assert.ok(groceries);
  assert.equal(groceries.currency, "GBP");
  // per-tx cap = largest single observed payment (no padding requested)
  assert.equal(groceries.suggestedPerTxCap, 35_00);
  // all three groceries payments fall inside one month → sum is the period cap
  assert.equal(groceries.suggestedPerPeriodCap, 70_00);
  // only the rails actually used appear, deterministically sorted
  assert.deepEqual(groceries.rails, ["card", "checkout"]);

  const saas = card.requiredMandates.find((r) => r.class === "saas")!;
  assert.equal(saas.currency, "USD");
  assert.equal(saas.suggestedPerTxCap, 9_00);
  assert.deepEqual(saas.rails, ["card"]);
});

test("deriveSpendCard is deterministic and pads caps when asked, rounding up", () => {
  const history: PaymentIntent[] = [
    pay({ id: "1", amount: 20_00, createdAt: "2026-05-01T00:00:00Z" }),
    pay({ id: "2", amount: 30_01, createdAt: "2026-05-02T00:00:00Z" }),
  ];
  const a = deriveSpendCard(history, { capPadding: 0.1 });
  const b = deriveSpendCard(history, { capPadding: 0.1 });
  assert.deepEqual(a, b);
  // 3001 * 1.1 = 3301.1 → ceil 3302
  assert.equal(a.requiredMandates[0].suggestedPerTxCap, 3302);
  // both fall in one month window: (2000 + 3001) * 1.1 = 5501.1 → 5502
  assert.equal(a.requiredMandates[0].suggestedPerPeriodCap, 5502);
});

test("lintSpendCard flags over-broad mandates; clean cards yield no warnings", () => {
  const overBroad: SpendMandateCard = {
    agentId: "x",
    requiredMandates: [
      {
        class: "*", // wildcard scope
        currency: "USDC",
        suggestedPerTxCap: 500_000, // high cap
        suggestedPerPeriodCap: 50_000_000, // 100x per-tx
        period: "month",
        rails: ["onchain"], // irreversible
      },
    ],
  };

  const warnings = lintSpendCard(overBroad);
  const codes = warnings.map((w) => w.code).sort();
  assert.deepEqual(codes, ["IRREVERSIBLE_HIGH_CAP", "OVERBROAD_CLASS", "WIDE_PERIOD_BUDGET"]);
  assert.ok(warnings.every((w) => w.severity === "warn"));

  const clean: SpendMandateCard = {
    agentId: "x",
    requiredMandates: [
      {
        class: "groceries",
        currency: "GBP",
        suggestedPerTxCap: 100_00,
        suggestedPerPeriodCap: 400_00,
        period: "week",
        rails: ["card"],
      },
    ],
  };
  assert.deepEqual(lintSpendCard(clean), []);
});

test("lintSpendCard never throws on a derived card and a derived clean history lints clean", () => {
  const history: PaymentIntent[] = [
    pay({ id: "1", amount: 12_00, rail: "card", createdAt: "2026-05-01T00:00:00Z" }),
    pay({ id: "2", amount: 14_00, rail: "card", createdAt: "2026-05-09T00:00:00Z" }),
  ];
  const card = deriveSpendCard(history);
  assert.doesNotThrow(() => lintSpendCard(card));
  assert.deepEqual(lintSpendCard(card), []);
});
