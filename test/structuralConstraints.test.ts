import test from "node:test";
import assert from "node:assert/strict";

import {
  detectStructuralConstraints,
  structuralConstraintDominates,
} from "../src/finance/structuralConstraints.ts";
import type { FinancialProfile } from "../src/finance/profile.ts";

function profile(over: Partial<FinancialProfile> = {}): FinancialProfile {
  return {
    currency: "GBP",
    monthlyIncomeMinor: 2000_00,
    monthlyEssentialSpendMinor: 1000_00, // healthy surplus by default
    liquidSavingsMinor: 3000_00,
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

test("a comfortable operator has no structural constraints and isn't dominated", () => {
  const p = profile();
  assert.deepEqual(detectStructuralConstraints(p), []);
  assert.equal(structuralConstraintDominates(p), false);
});

test("income below essentials is detected, named without blame, and dominates", () => {
  const p = profile({ monthlyIncomeMinor: 800_00, monthlyEssentialSpendMinor: 900_00 });
  const cs = detectStructuralConstraints(p);
  const squeeze = cs.find((c) => c.id === "income_below_essentials");
  assert.ok(squeeze);
  // the hard income squeeze leads (ordered first)
  assert.equal(cs[0].id, "income_below_essentials");
  // named as structural, not a discipline failure
  assert.match(squeeze.whyIframeFails.toLowerCase(), /structural|can't close|not overspending/);
  // the lever is systemic, not "spend less"
  assert.match(squeeze.systemicLever.toLowerCase(), /hardship|grant|income|reassess/);
  assert.equal(structuralConstraintDominates(p), true);
});

test("unclaimed support is the highest-value lever and dominates strategy", () => {
  const p = profile({ hasUnclaimedSupport: true });
  const cs = detectStructuralConstraints(p);
  assert.ok(cs.some((c) => c.id === "unclaimed_entitlements"));
  assert.equal(structuralConstraintDominates(p), true);
});

test("predatory-credit dependence is framed as infrastructure, not willpower, and dominates", () => {
  const p = profile({ reliesOnInformalCredit: true, highCostDebtMinor: 500_00 });
  const cs = detectStructuralConstraints(p);
  const credit = cs.find((c) => c.id === "predatory_credit_dependence");
  assert.ok(credit);
  assert.match(credit.whyIframeFails.toLowerCase(), /willpower|engineered|default/);
  assert.match(credit.systemicLever.toLowerCase(), /switch|consolidate|formal/);
  assert.equal(structuralConstraintDominates(p), true);
});

test("high-cost debt alone (no informal-credit flag) surfaces the credit constraint but does not auto-dominate", () => {
  const p = profile({ highCostDebtMinor: 500_00 });
  const cs = detectStructuralConstraints(p);
  assert.ok(cs.some((c) => c.id === "predatory_credit_dependence"));
  // dominance is reserved for no-surplus / unclaimed / informal-credit reliance
  assert.equal(structuralConstraintDominates(p), false);
});

test("no formal banking is an access barrier, not an effort gap", () => {
  const p = profile({ hasFormalBanking: false });
  const credit = detectStructuralConstraints(p).find((c) => c.id === "no_formal_banking");
  assert.ok(credit);
  assert.match(credit.whyIframeFails.toLowerCase(), /access|out of reach/);
});

test("entitlement blindspot fires only when not already flagged as unclaimed", () => {
  const blind = detectStructuralConstraints(profile({ entitlementsAware: false }));
  assert.ok(blind.some((c) => c.id === "entitlement_blindspot"));
  // when support is already known-unclaimed, we surface that (stronger) not the blindspot
  const known = detectStructuralConstraints(
    profile({ entitlementsAware: false, hasUnclaimedSupport: true }),
  );
  assert.ok(known.some((c) => c.id === "unclaimed_entitlements"));
  assert.ok(!known.some((c) => c.id === "entitlement_blindspot"));
});
