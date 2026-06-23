import { test } from "node:test";
import assert from "node:assert/strict";

import { forecastGoal, coverageReport } from "../src/finance/forecast.ts";
import type { FinancialGoal } from "../src/finance/goals.ts";
import type { FinancialProfile } from "../src/finance/profile.ts";

const NOW = "2026-05-30T12:00:00.000Z";

function profile(over: Partial<FinancialProfile> = {}): FinancialProfile {
  return {
    currency: "GBP",
    monthlyIncomeMinor: 2000_00,
    monthlyEssentialSpendMinor: 1000_00,
    liquidSavingsMinor: 3000_00, // ~3 months buffer
    highCostDebtMinor: 0,
    incomeVolatility: "stable",
    supportNetwork: "some",
    hasRoleModel: false,
    entitlementsAware: true,
    hasUnclaimedSupport: false,
    hasFormalBanking: true,
    reliesOnInformalCredit: false,
    stage: "late-student",
    financialAnxiety: "low",
    ...over,
  };
}

function houseGoal(over: Partial<FinancialGoal> = {}): FinancialGoal {
  return {
    id: "house",
    label: "house deposit",
    currency: "GBP",
    targetMinor: 20000_00,
    currentMinor: 2000_00,
    deadline: "2027-05-30T00:00:00.000Z", // ~12 months out
    ...over,
  };
}

// --- forecastGoal ---

test("a profile behind on a house deposit: required-monthly, positive gap, behind", () => {
  // surplus = £1000/mo; remaining = £18,000 over ~12 months → needs ~£1500/mo.
  const p = profile();
  const f = forecastGoal(p, houseGoal(), NOW);

  assert.equal(f.plan.remainingMinor, 18000_00);
  assert.ok(f.plan.requiredMonthlyMinor !== null);
  assert.ok(f.plan.requiredMonthlyMinor! > 1000_00); // required exceeds the £1000 surplus
  assert.equal(f.currentMonthlyMinor, 1000_00); // defaults to the surplus
  assert.ok(f.monthlyGapMinor > 0); // behind by £/month
  assert.equal(f.status, "behind");
  assert.ok(/[Bb]ehind/.test(f.nextAction));
  assert.ok(/LISA/.test(f.nextAction)); // house goal → LISA hint
  assert.ok(f.projectedDate !== null && f.projectedDate > (houseGoal().deadline ?? ""));
});

test("a profile on track: zero gap, 'on track', projected date present", () => {
  // surplus £1000/mo; planGoal counts ceil(365d/30) = 13 months to the deadline,
  // so a £13k target needs exactly £1000/mo → on track, zero gap.
  const p = profile();
  const g = houseGoal({ targetMinor: 13000_00, currentMinor: 0 });
  const f = forecastGoal(p, g, NOW);

  assert.equal(f.plan.monthsRemaining, 13);
  assert.equal(f.plan.requiredMonthlyMinor, 1000_00);
  assert.equal(f.monthlyGapMinor, 0);
  assert.equal(f.status, "on track");
  assert.ok(f.projectedDate !== null);
  assert.equal(f.monthsAtCurrentRate, 13);
});

test("a higher explicit contribution gets ahead of pace", () => {
  const p = profile();
  const g = houseGoal({ targetMinor: 12000_00, currentMinor: 0 });
  const f = forecastGoal(p, g, NOW, { currentMonthlyMinor: 2000_00 });
  assert.equal(f.status, "ahead");
  assert.equal(f.monthlyGapMinor, 0);
});

test("no surplus → stalled with a free-up-room action", () => {
  const p = profile({ monthlyIncomeMinor: 1000_00, monthlyEssentialSpendMinor: 1000_00 });
  const f = forecastGoal(p, houseGoal(), NOW);
  assert.equal(f.currentMonthlyMinor, 0);
  assert.equal(f.status, "stalled");
  assert.equal(f.monthsAtCurrentRate, null);
  assert.equal(f.projectedDate, null);
  assert.ok(/free up/i.test(f.nextAction));
});

test("an already-reached goal reports reached", () => {
  const f = forecastGoal(profile(), houseGoal({ currentMinor: 20000_00 }), NOW);
  assert.equal(f.status, "reached");
  assert.equal(f.plan.remainingMinor, 0);
});

test("a positive growth rate reaches the target no later than simple saving", () => {
  const p = profile();
  const g = houseGoal({ targetMinor: 12000_00, currentMinor: 0 });
  const simple = forecastGoal(p, g, NOW);
  const grown = forecastGoal(p, g, NOW, { monthlyGrowthRate: 0.01 });
  assert.ok(grown.monthsAtCurrentRate! <= simple.monthsAtCurrentRate!);
});

// --- coverageReport ---

test("coverage flags the missing foundations, each with a next action", () => {
  // No buffer, high-cost debt, unclaimed support, house goal w/o LISA.
  const p = profile({
    liquidSavingsMinor: 0,
    highCostDebtMinor: 500_00,
    hasUnclaimedSupport: true,
  });
  const report = coverageReport(p, [houseGoal()], NOW);

  const kinds = report.gaps.map((g) => g.kind);
  assert.ok(kinds.includes("emergency_buffer"));
  assert.ok(kinds.includes("high_cost_debt"));
  assert.ok(kinds.includes("unclaimed_support"));
  assert.ok(kinds.includes("unused_lisa"));

  // every gap names a concrete next action
  for (const g of report.gaps) {
    assert.ok(g.nextAction.length > 0, `${g.kind} missing nextAction`);
  }

  // high-severity foundations sort first
  assert.equal(report.gaps[0].severity, "high");

  // the house goal is behind (no buffer means the surplus is spread thin) → folded in
  assert.ok(report.goalsBehind.includes("house"));
  assert.equal(report.covered, false);
});

test("idle cash is flagged once the buffer and debt are sorted", () => {
  const p = profile({ liquidSavingsMinor: 20000_00 }); // 20 months of essentials
  const report = coverageReport(p, [], NOW);
  const idle = report.gaps.find((g) => g.kind === "idle_cash");
  assert.ok(idle);
  assert.equal(idle.severity, "low");
  assert.ok(/idle/i.test(idle.finding));
});

test("a sorted, debt-free, buffered profile with no goals is covered", () => {
  // exactly the 6-month idle floor → no idle gap; no debt; healthy buffer.
  const p = profile({ liquidSavingsMinor: 6000_00, stage: "late-student" });
  const report = coverageReport(p, [], NOW);
  assert.deepEqual(report.gaps, []);
  assert.equal(report.covered, true);
});

test("pension nudge appears for an established, sorted profile", () => {
  const p = profile({ stage: "established", liquidSavingsMinor: 6000_00 });
  const report = coverageReport(p, [], NOW);
  assert.ok(report.gaps.some((g) => g.kind === "no_pension_thought"));
});
