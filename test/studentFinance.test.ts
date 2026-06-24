import { test } from "node:test";
import assert from "node:assert/strict";

import {
  maintenanceShortfall,
  estimateMaintenanceLoanMinor,
  maintenanceSummary,
  type StudentLocation,
} from "../src/finance/studentFinance.ts";

// --- maintenanceShortfall ---

test("London rent above the loan: coversRent false + correct monthly gap", () => {
  // Loan £13,348/yr; rent £15,600/yr (£300/wk × 52). Gap = £2,252/yr.
  const s = maintenanceShortfall({
    annualLoanMinor: 13_348_00,
    annualRentMinor: 15_600_00,
  });
  assert.equal(s.coversRent, false);
  assert.equal(s.annualGapMinor, 2_252_00);
  // £2,252 over 12 months, ceil → £187.67/mo = 18767 minor-units.
  assert.equal(s.monthlyGapMinor, Math.ceil(2_252_00 / 12));
  assert.equal(s.surplusAfterRentMinor, 0);
  assert.ok(s.rentCoverageRatio < 1);
});

test("other support can close the gap → coversRent true, surplus carried", () => {
  const s = maintenanceShortfall({
    annualLoanMinor: 10_227_00,
    annualRentMinor: 11_000_00,
    otherSupportMinor: 2_000_00, // parental contribution closes + exceeds the gap
  });
  assert.equal(s.coversRent, true);
  assert.equal(s.annualGapMinor, 0);
  assert.equal(s.monthlyGapMinor, 0);
  assert.equal(s.surplusAfterRentMinor, 1_227_00);
  assert.ok(s.rentCoverageRatio > 1);
});

test("the weekly view uses the tenancy length", () => {
  const s = maintenanceShortfall({
    annualLoanMinor: 0,
    annualRentMinor: 5_200_00,
    weeksPerYear: 40,
  });
  // £5,200 gap over 40 weeks → £130/wk.
  assert.equal(s.weeklyGapMinor, 130_00);
});

test("zero rent never produces a negative coverage ratio", () => {
  const s = maintenanceShortfall({ annualLoanMinor: 10_227_00, annualRentMinor: 0 });
  assert.equal(s.coversRent, true);
  assert.equal(s.annualGapMinor, 0);
  assert.equal(s.rentCoverageRatio, 1);
});

// --- estimateMaintenanceLoanMinor ---

test("a low household income estimates a higher loan than a high income", () => {
  const low = estimateMaintenanceLoanMinor({
    householdIncomeMinor: 20_000_00,
    location: "outside-london",
  });
  const high = estimateMaintenanceLoanMinor({
    householdIncomeMinor: 60_000_00,
    location: "outside-london",
  });
  assert.ok(low > high, "low income should yield the larger maintenance loan");
});

test("below the taper start, the full outside-London maximum applies", () => {
  const est = estimateMaintenanceLoanMinor({
    householdIncomeMinor: 18_000_00,
    location: "outside-london",
  });
  assert.equal(est, 10_227_00); // documented 2024/25 outside-London max
});

test("the outside-London cap is respected — no income yields more than the max", () => {
  const incomes = [0, 10_000_00, 24_999_00, 25_000_00, 40_000_00, 70_000_00];
  for (const householdIncomeMinor of incomes) {
    const est = estimateMaintenanceLoanMinor({
      householdIncomeMinor,
      location: "outside-london",
    });
    assert.ok(est <= 10_227_00, `income ${householdIncomeMinor} exceeded the cap`);
    assert.ok(est >= Math.round(10_227_00 * 0.38), "estimate fell below the floor");
  }
});

test("London awards more than outside-London at the same income", () => {
  const income = 22_000_00;
  const london = estimateMaintenanceLoanMinor({ householdIncomeMinor: income, location: "london" });
  const outside = estimateMaintenanceLoanMinor({ householdIncomeMinor: income, location: "outside-london" });
  const home = estimateMaintenanceLoanMinor({ householdIncomeMinor: income, location: "at-home" });
  assert.ok(london > outside);
  assert.ok(outside > home);
});

test("the taper is monotonic non-increasing across the band", () => {
  const loc: StudentLocation = "outside-london";
  let prev = Infinity;
  for (let inc = 0; inc <= 70_000_00; inc += 5_000_00) {
    const est = estimateMaintenanceLoanMinor({ householdIncomeMinor: inc, location: loc });
    assert.ok(est <= prev, `loan rose at income ${inc}`);
    prev = est;
  }
});

// --- maintenanceSummary ---

test("a real gap produces a headline naming the monthly gap and a sells-nothing plan", () => {
  const summary = maintenanceSummary({
    annualLoanMinor: 13_348_00,
    annualRentMinor: 15_600_00,
  });
  assert.equal(summary.shortfall.coversRent, false);
  assert.match(summary.headline, /gap/);
  assert.match(summary.headline, /£/);
  assert.ok(summary.plan.length > 0);
  // action-first + sells nothing: no product pitch, mentions hardship/bursary support.
  const joined = summary.plan.join(" ").toLowerCase();
  assert.ok(/hardship|bursary/.test(joined));
  assert.ok(!/buy|sign up|invest in|product/.test(joined));
});

test("when support covers rent, the summary says so without inventing a gap", () => {
  const summary = maintenanceSummary({
    annualLoanMinor: 10_227_00,
    annualRentMinor: 6_000_00,
  });
  assert.equal(summary.shortfall.coversRent, true);
  assert.match(summary.headline, /covers/);
  assert.equal(summary.shortfall.monthlyGapMinor, 0);
  assert.ok(summary.plan.length > 0);
});
