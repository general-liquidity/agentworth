import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EMOJI_OPTIONS,
  applyCheckIn,
  checkInPrompt,
  readCheckIn,
  readCheckInOrDefault,
  type MoneyFeeling,
} from "../src/finance/emotionalCheckIn.ts";
import { chooseCommunication } from "../src/finance/communication.ts";
import { assessResilience } from "../src/finance/resilience.ts";
import type { AnxietyLevel, FinancialProfile } from "../src/finance/profile.ts";

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

// --- each emoji maps to the expected harness state ---

const EXPECTED: Record<MoneyFeeling, AnxietyLevel> = {
  overwhelm: "high",
  confusion: "high",
  disengagement: "moderate",
  aspiration: "low",
  defeat: "defeated",
};

test("every research cluster has exactly one emoji option", () => {
  const feelings = EMOJI_OPTIONS.map((o) => o.feeling).sort();
  assert.deepEqual(feelings, ["aspiration", "confusion", "defeat", "disengagement", "overwhelm"]);
});

test("each emoji maps to the expected anxiety state", () => {
  for (const o of EMOJI_OPTIONS) {
    const state = readCheckIn(o.emoji);
    assert.ok(state, `emoji ${o.emoji} should resolve`);
    assert.equal(state.feeling, o.feeling);
    assert.equal(state.anxiety, EXPECTED[o.feeling]);
  }
});

test("a pick can be made by feeling label or cluster name too", () => {
  assert.equal(readCheckIn("overwhelmed")?.feeling, "overwhelm");
  assert.equal(readCheckIn("  Confused  ")?.feeling, "confusion"); // case + whitespace tolerant
  assert.equal(readCheckIn("aspiration")?.feeling, "aspiration");
});

// --- defeat is a first-class state → agency-restoring communication ---

test("defeat maps to the distinct 'defeated' state and restores agency", () => {
  const state = readCheckIn("😞");
  assert.ok(state);
  assert.equal(state.feeling, "defeat");
  assert.equal(state.approximated, false);
  assert.equal(state.anxiety, "defeated");
  // and it drives the agency-restoring comms mode, not generic reassurance
  const p = applyCheckIn(profile({ financialAnxiety: "low" }), state);
  assert.equal(chooseCommunication(p, assessResilience(p)).mode, "restore_agency");
});

test("non-approximated feelings have an exact home", () => {
  for (const f of ["overwhelm", "confusion", "disengagement", "aspiration"] as const) {
    assert.equal(readCheckIn(f)?.approximated, false);
  }
});

// --- unknown input is handled gracefully ---

test("readCheckIn returns undefined for unknown input", () => {
  assert.equal(readCheckIn("🚀"), undefined);
  assert.equal(readCheckIn("blah"), undefined);
  assert.equal(readCheckIn(""), undefined);
  assert.equal(readCheckIn("   "), undefined);
});

test("readCheckInOrDefault falls back conservatively (moderate / disengaged)", () => {
  const fallback = readCheckInOrDefault("🚀");
  assert.equal(fallback.feeling, "disengagement");
  assert.equal(fallback.anxiety, "moderate");
  // a recognised pick still resolves normally
  assert.equal(readCheckInOrDefault("😰").anxiety, "high");
});

// --- the prompt lists the options ---

test("checkInPrompt produces a question and the option list", () => {
  const p = checkInPrompt();
  assert.ok(p.question.length > 0);
  assert.equal(p.options.length, EMOJI_OPTIONS.length);
  assert.ok(p.options.every((o) => o.emoji.length > 0 && o.label.length > 0));
});

// --- recording updates the profile and flows into communication ---

test("applyCheckIn records the anxiety state without mutating the input", () => {
  const p = profile({ financialAnxiety: "low" });
  const state = readCheckIn("😰")!;
  const updated = applyCheckIn(p, state);
  assert.equal(updated.financialAnxiety, "high");
  assert.equal(p.financialAnxiety, "low"); // original untouched (pure)
});

test("a check-in flows through to the communication mode", () => {
  const p = profile({ financialAnxiety: "low" });
  const overwhelmed = applyCheckIn(p, readCheckIn("😰")!);
  const guidance = chooseCommunication(overwhelmed, assessResilience(overwhelmed));
  assert.equal(guidance.mode, "reassure_first");
});
