import { test } from "node:test";
import assert from "node:assert/strict";

import { checkEmpowerment, type ProposedAction } from "../src/finance/ethics.ts";
import { chooseCommunication } from "../src/finance/communication.ts";
import { buildFinanceSystemPrompt } from "../src/finance/persona.ts";
import { assessResilience } from "../src/finance/resilience.ts";
import type { FinancialProfile } from "../src/finance/profile.ts";

function profile(over: Partial<FinancialProfile> = {}): FinancialProfile {
  return {
    currency: "GBP",
    monthlyIncomeMinor: 2000_00,
    monthlyEssentialSpendMinor: 1000_00,
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

function action(over: Partial<ProposedAction> = {}): ProposedAction {
  return {
    summary: "set up a small recurring transfer to the emergency buffer",
    usesHighCostCredit: false,
    manufacturesUrgency: false,
    exploitsAnxiety: false,
    servesResilienceOrGoal: true,
    ...over,
  };
}

// --- empower-don't-exploit guardrail ---

test("a high-cost-credit suggestion is exploitative", () => {
  const c = checkEmpowerment(action({ usesHighCostCredit: true }), { anxietyDriven: false });
  assert.equal(c.verdict, "exploitative");
  assert.ok(c.reasons.some((r) => r.includes("high-cost credit")));
});

test("manufactured urgency is exploitative", () => {
  const c = checkEmpowerment(action({ manufacturesUrgency: true }), { anxietyDriven: false });
  assert.equal(c.verdict, "exploitative");
});

test("a clean resilience-serving action is empowering", () => {
  const c = checkEmpowerment(action(), { anxietyDriven: false });
  assert.equal(c.verdict, "empowering");
});

test("an action that serves nothing is flagged caution", () => {
  const c = checkEmpowerment(action({ servesResilienceOrGoal: false }), {
    anxietyDriven: false,
  });
  assert.equal(c.verdict, "caution");
});

// --- soft-saving guardrail (work within the operator's stated values) ---

test("moralising spending / guilt-tripping enjoyment is exploitative", () => {
  const c = checkEmpowerment(action({ moralisesSpending: true }), { anxietyDriven: false });
  assert.equal(c.verdict, "exploitative");
  assert.ok(c.reasons.some((r) => r.includes("moralises spending")));
});

test("pushing thrift against a stated quality-of-life preference is exploitative", () => {
  const c = checkEmpowerment(action({ pushesSavingOverStatedQoL: true }), {
    anxietyDriven: false,
    valuesQualityOfLife: true,
  });
  assert.equal(c.verdict, "exploitative");
  assert.ok(c.reasons.some((r) => r.includes("quality-of-life")));
});

test("an anxiety-leaning nudge is exploitative", () => {
  const c = checkEmpowerment(action({ exploitsAnxiety: true }), { anxietyDriven: true });
  assert.equal(c.verdict, "exploitative");
  assert.ok(c.reasons.some((r) => r.includes("anxiety")));
});

test("informing about a genuine concern, respecting values, still passes", () => {
  // Saving advice that does NOT override the stated quality-of-life preference
  // is ordinary information, not moralising — it stays empowering.
  const c = checkEmpowerment(action({ pushesSavingOverStatedQoL: false }), {
    anxietyDriven: false,
    valuesQualityOfLife: true,
  });
  assert.equal(c.verdict, "empowering");
});

// --- communication mode (behaviour over knowledge) ---

test("high anxiety selects reassure-first", () => {
  const p = profile({ financialAnxiety: "high" });
  assert.equal(chooseCommunication(p, assessResilience(p)).mode, "reassure_first");
});

test("an early-stage operator gets plain, low-friction communication", () => {
  const p = profile({ stage: "early-student", financialAnxiety: "low" });
  assert.equal(chooseCommunication(p, assessResilience(p)).mode, "plain_low_friction");
});

test("a secure, low-anxiety operator can get detailed communication", () => {
  const p = profile({
    stage: "established",
    financialAnxiety: "low",
    monthlyIncomeMinor: 3000_00,
    liquidSavingsMinor: 9000_00,
    supportNetwork: "strong",
    hasRoleModel: true,
  });
  assert.equal(chooseCommunication(p, assessResilience(p)).mode, "detailed");
});

// --- the persona (harness → agent system prompt) ---

test("the system prompt encodes the agenda, posture, and communication mode", () => {
  const p = profile({ supportNetwork: "none", hasRoleModel: false }); // weak social
  const r = assessResilience(p);
  const prompt = buildFinanceSystemPrompt(p, r);
  assert.ok(prompt.includes(r.weakestPillar)); // standing agenda = weakest pillar
  assert.match(prompt, /mandate/); // governed by the gate
  assert.match(prompt, /[Ee]mpower/); // empower-don't-exploit posture
  assert.match(prompt, /non-custodial/i); // operator-aligned posture
  assert.ok(prompt.includes(chooseCommunication(p, r).mode));
});
