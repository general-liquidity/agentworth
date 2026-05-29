import { test } from "node:test";
import assert from "node:assert/strict";

import { createMemoryStore } from "../src/store/memoryStore.ts";
import { periodStart } from "../src/core/store.ts";
import type { Mandate } from "../src/core/types.ts";

test("periodStart anchors to UTC day/week/month boundaries", () => {
  const now = "2026-05-29T12:34:56.000Z"; // a Friday
  assert.equal(periodStart(now, "day"), "2026-05-29T00:00:00.000Z");
  assert.equal(periodStart(now, "week"), "2026-05-25T00:00:00.000Z"); // Monday
  assert.equal(periodStart(now, "month"), "2026-05-01T00:00:00.000Z");
});

test("periodSpend only counts settled payments inside the current period", () => {
  const store = createMemoryStore("k");
  store.insertMandate({
    id: "m",
    label: "groceries",
    scope: { kind: "class", value: "groceries" },
    currency: "GBP",
    allowedRails: ["card"],
    perTxCap: 50000,
    perPeriodCap: 100000,
    period: "week",
    grantedAt: "2026-05-01T00:00:00.000Z",
    expiresAt: "2026-12-01T00:00:00.000Z",
    status: "active",
  } satisfies Mandate);

  const base = {
    payeeClass: "groceries",
    currency: "GBP",
    rail: "card" as const,
    rationale: "shop",
  };
  // Inside this week.
  store.insertIntent({
    intent: { id: "a", payee: "tesco", amount: 1000, createdAt: "x", ...base },
    status: "settled",
    mandateId: "m",
    reasons: [],
    settledAt: "2026-05-26T10:00:00.000Z",
    receiptId: "r1",
  });
  // Last week — must be excluded.
  store.insertIntent({
    intent: { id: "b", payee: "tesco", amount: 9999, createdAt: "x", ...base },
    status: "settled",
    mandateId: "m",
    reasons: [],
    settledAt: "2026-05-20T10:00:00.000Z",
    receiptId: "r2",
  });
  // Pending — not yet spent.
  store.insertIntent({
    intent: { id: "c", payee: "tesco", amount: 5000, createdAt: "x", ...base },
    status: "pending",
    mandateId: "m",
    reasons: [],
    settledAt: null,
    receiptId: null,
  });

  const spend = store.periodSpend("m", "2026-05-29T12:00:00.000Z");
  assert.equal(spend.length, 1);
  assert.equal(spend[0].amount, 1000);
  assert.deepEqual([...store.knownPayees()], ["tesco"]);
});
