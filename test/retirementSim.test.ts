import { test } from "node:test";
import assert from "node:assert/strict";

import {
  projectRetirement,
  sensitivity,
  startNowVsLater,
  retirementSummary,
} from "../src/finance/retirementSim.ts";

test("positive-rate projection: pot exceeds total contributions (growth > 0)", () => {
  const p = projectRetirement({
    currentPotMinor: 0,
    monthlyContributionMinor: 20_000, // £200/mo
    yearsToRetirement: 30,
    annualGrowthRate: 0.05,
  });
  // Raw paid in = £200 × 360 months = £72,000.
  assert.equal(p.totalContributedMinor, 7_200_000);
  // Compounding makes the pot strictly larger than what was paid in.
  assert.ok(
    p.projectedPotMinor > p.totalContributedMinor,
    `expected pot ${p.projectedPotMinor} > contributions ${p.totalContributedMinor}`,
  );
  // growth = pot − startPot − contributions, strictly positive at 5%.
  assert.ok(p.growthMinor > 0);
  assert.equal(p.growthMinor, p.projectedPotMinor - 0 - p.totalContributedMinor);
  // £200/mo at 5% for 30 years lands around £166k — order-of-magnitude sanity.
  assert.ok(p.projectedPotMinor > 15_000_000); // > £150k
  assert.ok(p.projectedPotMinor < 18_000_000); // < £180k
});

test("the existing pot compounds too (start pot grows on top of contributions)", () => {
  const withStart = projectRetirement({
    currentPotMinor: 1_000_000, // £10k already saved
    monthlyContributionMinor: 0,
    yearsToRetirement: 10,
    annualGrowthRate: 0.05,
  });
  // £10k at 5% monthly-compounded for 10 years > £10k, and ~£16.5k.
  assert.ok(withStart.projectedPotMinor > 1_000_000);
  assert.equal(withStart.totalContributedMinor, 0);
  assert.ok(withStart.projectedPotMinor > 1_600_000);
  assert.ok(withStart.projectedPotMinor < 1_700_000);
});

test("zero-rate case collapses to start pot + raw contributions (no growth)", () => {
  const base = {
    currentPotMinor: 500_000, // £5k
    monthlyContributionMinor: 10_000, // £100/mo
    yearsToRetirement: 20,
    annualGrowthRate: 0,
  };
  const z = projectRetirement(base);
  // 20 years × 12 × £100 = £24,000 paid in, + £5k start = £29,000, no growth.
  assert.equal(z.totalContributedMinor, 2_400_000);
  assert.equal(z.projectedPotMinor, 500_000 + 2_400_000);
  assert.equal(z.growthMinor, 0);
  // Omitting the delta/rate effects, an omitted-vs-zero rate is identical here.
});

test("sensitivity is monotonic: more £/mo → strictly bigger pot", () => {
  const base = {
    currentPotMinor: 0,
    monthlyContributionMinor: 10_000, // £100/mo
    yearsToRetirement: 25,
    annualGrowthRate: 0.05,
  };
  const small = sensitivity({ ...base, deltaMonthlyMinor: 2_500 }); // +£25/mo
  const big = sensitivity({ ...base, deltaMonthlyMinor: 10_000 }); // +£100/mo
  // A positive delta yields a positive extra pot.
  assert.ok(small.deltaPotMinor > 0);
  // More monthly → strictly bigger pot AND strictly bigger delta.
  assert.ok(big.deltaPotMinor > small.deltaPotMinor);
  assert.ok(big.projectedPotMinor > small.projectedPotMinor);
  // A negative delta reduces the pot symmetrically (lever works both ways).
  const cut = sensitivity({ ...base, deltaMonthlyMinor: -2_500 });
  assert.ok(cut.deltaPotMinor < 0);
});

test("sensitivity delta equals projecting the changed contribution directly", () => {
  const base = {
    currentPotMinor: 250_000,
    monthlyContributionMinor: 15_000,
    yearsToRetirement: 30,
    annualGrowthRate: 0.06,
  };
  const s = sensitivity({ ...base, deltaMonthlyMinor: 5_000 });
  const direct = projectRetirement({
    ...base,
    monthlyContributionMinor: base.monthlyContributionMinor + 5_000,
  });
  assert.equal(s.projectedPotMinor, direct.projectedPotMinor);
  assert.equal(
    s.deltaPotMinor,
    direct.projectedPotMinor - projectRetirement(base).projectedPotMinor,
  );
});

test("startNowVsLater: a delay costs money (hand-checkable at zero rate)", () => {
  // Zero rate, no start pot: delaying simply drops the contributions that would
  // have landed during the delay. £100/mo, 30yr horizon, 10yr delay → lose exactly
  // 10 years × 12 × £100 = £12,000.
  const w = startNowVsLater({
    currentPotMinor: 0,
    monthlyContributionMinor: 10_000, // £100/mo
    yearsToRetirement: 30,
    annualGrowthRate: 0,
    delayYears: 10,
  });
  assert.equal(w.startNowPotMinor, 10_000 * 360); // £36,000
  assert.equal(w.startLaterPotMinor, 10_000 * 240); // £24,000
  assert.equal(w.costOfWaitingMinor, 1_200_000); // exactly £12,000
});

test("startNowVsLater: at a positive rate the cost exceeds the raw contributions lost", () => {
  // Same delay, but at 5% the EARLY contributions also lose the most compounding,
  // so the cost of waiting is strictly more than the bare £12k of contributions.
  const w = startNowVsLater({
    currentPotMinor: 0,
    monthlyContributionMinor: 10_000,
    yearsToRetirement: 30,
    annualGrowthRate: 0.05,
    delayYears: 10,
  });
  assert.ok(w.startNowPotMinor > w.startLaterPotMinor);
  assert.ok(
    w.costOfWaitingMinor > 1_200_000,
    `cost ${w.costOfWaitingMinor} should exceed the £12k of bare contributions lost`,
  );
});

test("startNowVsLater: delay >= horizon means no contributions ever land", () => {
  const w = startNowVsLater({
    currentPotMinor: 100_000,
    monthlyContributionMinor: 10_000,
    yearsToRetirement: 20,
    annualGrowthRate: 0.05,
    delayYears: 25, // longer than the horizon
  });
  // Later pot = just the start pot grown for the full horizon (no contributions).
  const startGrown = projectRetirement({
    currentPotMinor: 100_000,
    monthlyContributionMinor: 0,
    yearsToRetirement: 20,
    annualGrowthRate: 0.05,
  }).projectedPotMinor;
  assert.equal(w.startLaterPotMinor, startGrown);
  assert.ok(w.costOfWaitingMinor > 0);
});

test("retirementSummary is action-first, tangible, sells nothing, no guilt", () => {
  const s = retirementSummary({
    currentPotMinor: 0,
    monthlyContributionMinor: 2_500, // £25/mo
    yearsToRetirement: 40,
    annualGrowthRate: 0.05,
    deltaMonthlyMinor: 2_500, // £25/mo more
    delayYears: 5,
  });
  assert.ok(s.includes("by retirement"));
  assert.ok(s.includes("£25")); // the small, concrete lever
  assert.ok(s.includes("more at retirement"));
  assert.ok(s.toLowerCase().includes("waiting"));
  assert.ok(s.toLowerCase().includes("costs you"));
  // No guilt / shame / doom language.
  for (const banned of ["too late", "waste", "wasting", "guilt", "should have", "behind", "fail"]) {
    assert.ok(!s.toLowerCase().includes(banned), `summary should not contain "${banned}"`);
  }
});

test("retirementSummary omits the levers when not asked", () => {
  const s = retirementSummary({
    currentPotMinor: 0,
    monthlyContributionMinor: 10_000,
    yearsToRetirement: 30,
    annualGrowthRate: 0.05,
  });
  assert.ok(s.includes("by retirement"));
  assert.ok(!s.toLowerCase().includes("waiting"));
  assert.ok(!s.includes("more at retirement"));
});
