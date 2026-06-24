import { test } from "node:test";
import assert from "node:assert/strict";

import {
  slipCost,
  rankSlips,
  slipSummary,
  type NamedSlip,
} from "../src/finance/slipCost.ts";

test("daily £3.50 coffee over 1 year ≈ £1,277.50 annual (hand-checkable)", () => {
  // 350 minor × 365 days = 127,750 minor = £1,277.50
  const c = slipCost({ amountMinor: 350, cadence: "daily", years: 1 });
  assert.equal(c.annualMinor, 127_750);
  assert.equal(c.totalSpentMinor, 127_750);
  // No growth rate → future value equals the raw total, no foregone growth.
  assert.equal(c.futureValueIfInvestedMinor, 127_750);
  assert.equal(c.foregoneGrowthMinor, 0);
});

test("future-value-if-invested at a positive rate exceeds the raw total", () => {
  const c = slipCost({
    amountMinor: 350,
    cadence: "daily",
    years: 10,
    annualGrowthRate: 0.05,
  });
  // Raw total over 10 years = 127,750 × 10 = 1,277,500 minor.
  assert.equal(c.totalSpentMinor, 1_277_500);
  // Compounded contributions beat the raw total.
  assert.ok(
    c.futureValueIfInvestedMinor > c.totalSpentMinor,
    `expected FV ${c.futureValueIfInvestedMinor} > total ${c.totalSpentMinor}`,
  );
  // foregoneGrowth = FV − contributions, strictly positive at 5%.
  assert.ok(c.foregoneGrowthMinor > 0);
  assert.equal(
    c.foregoneGrowthMinor,
    c.futureValueIfInvestedMinor - c.totalSpentMinor,
  );
  // Sanity: a £3.50/day habit invested at 5% for 10 years lands ~£16k order of
  // magnitude (well above the ~£12.8k raw total, below £20k).
  assert.ok(c.futureValueIfInvestedMinor > 1_500_000);
  assert.ok(c.futureValueIfInvestedMinor < 2_000_000);
});

test("a 0 / omitted growth rate collapses to the raw total", () => {
  const zero = slipCost({
    amountMinor: 500,
    cadence: "weekly",
    years: 5,
    annualGrowthRate: 0,
  });
  const omitted = slipCost({ amountMinor: 500, cadence: "weekly", years: 5 });
  assert.deepEqual(zero, omitted);
  assert.equal(zero.futureValueIfInvestedMinor, zero.totalSpentMinor);
  assert.equal(zero.foregoneGrowthMinor, 0);
});

test("cadence annualisation: weekly ×52, monthly ×12", () => {
  assert.equal(slipCost({ amountMinor: 1_000, cadence: "weekly", years: 1 }).annualMinor, 52_000);
  assert.equal(slipCost({ amountMinor: 1_000, cadence: "monthly", years: 1 }).annualMinor, 12_000);
});

test("rankSlips orders by annual drain (descending)", () => {
  const slips: NamedSlip[] = [
    { label: "weekly takeaway", amountMinor: 1_500, cadence: "weekly" }, // £780/yr
    { label: "daily coffee", amountMinor: 350, cadence: "daily" }, // £1,277.50/yr
    { label: "monthly streaming", amountMinor: 1_200, cadence: "monthly" }, // £144/yr
  ];
  const ranked = rankSlips(slips, { years: 5, annualGrowthRate: 0.05 });
  assert.deepEqual(
    ranked.map((r) => r.label),
    ["daily coffee", "weekly takeaway", "monthly streaming"],
  );
  // Annual drains strictly descending.
  for (let i = 1; i < ranked.length; i += 1) {
    assert.ok(ranked[i - 1].cost.annualMinor >= ranked[i].cost.annualMinor);
  }
  // Each ranked slip carries a swap + a summary.
  for (const r of ranked) {
    assert.ok(r.swap.length > 0);
    assert.ok(r.summary.includes(r.label));
  }
});

test("meal-deal + coffee daily example lands in the right order of magnitude", () => {
  // University of Bristol money advisor: a daily meal-deal + Costa coffee ≈ HALF
  // a student's annual maintenance loan. Maintenance loan ~£10k/yr → half ~£5k.
  // Meal-deal £3.90 + coffee £3.50 = £7.40/day.
  const mealDeal = slipCost({ amountMinor: 390, cadence: "daily", years: 1 });
  const coffee = slipCost({ amountMinor: 350, cadence: "daily", years: 1 });
  const combinedAnnual = mealDeal.annualMinor + coffee.annualMinor;
  // £7.40 × 365 = £2,701 ... hmm that's a quarter, not half — the advisor's
  // "half" figure implies a higher daily spend / lower loan; assert the right
  // order of magnitude: a few thousand £/yr, i.e. a large slice of maintenance.
  assert.equal(combinedAnnual, 270_100); // £2,701.00, hand-checkable
  assert.ok(combinedAnnual > 200_000); // > £2,000/yr
  assert.ok(combinedAnnual < 500_000); // < £5,000/yr — same order as the advisor's claim
});

test("slipSummary is action-first, names the swap, no guilt language", () => {
  const cost = slipCost({
    amountMinor: 350,
    cadence: "daily",
    years: 10,
    annualGrowthRate: 0.05,
  });
  const s = slipSummary({
    label: "coffee",
    amountMinor: 350,
    cadence: "daily",
    years: 10,
    cost,
    swap: "brew at home and redirect it to your deposit",
  });
  assert.ok(s.includes("£3.50"));
  assert.ok(s.includes("/yr"));
  assert.ok(s.includes("here's the swap"));
  assert.ok(s.includes("brew at home"));
  // No guilt / shame language.
  for (const banned of ["waste", "wasting", "guilt", "should not", "shouldn't", "stop"]) {
    assert.ok(!s.toLowerCase().includes(banned), `summary should not contain "${banned}"`);
  }
});

test("a generic swap is supplied when a slip carries none", () => {
  const ranked = rankSlips([{ label: "daily coffee", amountMinor: 350, cadence: "daily" }], {
    years: 5,
  });
  assert.ok(ranked[0].swap.length > 0);
  assert.ok(ranked[0].swap.toLowerCase().includes("redirect"));
});
