import { test } from "node:test";
import assert from "node:assert/strict";

import {
  detectKnowledgeGaps,
  KNOWLEDGE_GAP_CATALOGUE,
  type KnowledgeGapId,
  type KnowledgeSignals,
} from "../src/finance/knowledgeGaps.ts";
import type { FinancialProfile } from "../src/finance/profile.ts";

// A deliberately well-informed, clean baseline: no debt, modest buffer only,
// nothing idle, allowance maxed, registered to vote, cash above inflation, and a
// role model. Each gap test mutates ONE axis off this base to trip exactly that gap.
const CLEAN: FinancialProfile = {
  currency: "GBP",
  monthlyIncomeMinor: 150_000,
  monthlyEssentialSpendMinor: 150_000, // no monthly surplus to deploy
  liquidSavingsMinor: 150_000, // exactly one month buffer, nothing idle beyond it
  highCostDebtMinor: 0,
  incomeVolatility: "stable",
  supportNetwork: "strong",
  hasRoleModel: true,
  entitlementsAware: true,
  hasUnclaimedSupport: false,
  hasFormalBanking: true,
  reliesOnInformalCredit: false,
  stage: "early-career",
  financialAnxiety: "low",
};

const CLEAN_SIGNALS: KnowledgeSignals = {
  isaUsedFraction: 1, // allowance maxed
  registeredToVote: true,
  cashSavingsRate: 0.05, // above inflation
  inflationRate: 0.03,
};

function idsOf(profile: FinancialProfile, signals?: KnowledgeSignals): KnowledgeGapId[] {
  return detectKnowledgeGaps(profile, signals).map((g) => g.id);
}

test("clean, well-informed profile triggers no gaps", () => {
  assert.deepEqual(detectKnowledgeGaps(CLEAN, CLEAN_SIGNALS), []);
});

test("money-isnt-an-asset trips on idle cash with no role model", () => {
  const p: FinancialProfile = { ...CLEAN, hasRoleModel: false, liquidSavingsMinor: 500_000 };
  assert.ok(idsOf(p, CLEAN_SIGNALS).includes("money-isnt-an-asset"));
});

test("debt-not-prioritised trips whenever high-cost debt is held", () => {
  const p: FinancialProfile = { ...CLEAN, highCostDebtMinor: 80_000 };
  assert.ok(idsOf(p, CLEAN_SIGNALS).includes("debt-not-prioritised"));
});

test("isa-allowance-unknown trips when allowance is under-used with capacity", () => {
  const p: FinancialProfile = { ...CLEAN, liquidSavingsMinor: 600_000 }; // idle cash to shelter
  const ids = idsOf(p, { ...CLEAN_SIGNALS, isaUsedFraction: 0.1 });
  assert.ok(ids.includes("isa-allowance-unknown"));
});

test("isa-allowance-unknown trips when usage is unknown but capacity exists", () => {
  const p: FinancialProfile = { ...CLEAN, liquidSavingsMinor: 600_000 };
  const ids = idsOf(p, { ...CLEAN_SIGNALS, isaUsedFraction: undefined });
  assert.ok(ids.includes("isa-allowance-unknown"));
});

test("credit-score-factors-misunderstood trips when not registered to vote", () => {
  const ids = idsOf(CLEAN, { ...CLEAN_SIGNALS, registeredToVote: false });
  assert.ok(ids.includes("credit-score-factors-misunderstood"));
});

test("compounding-frequency trips when there is cash to place", () => {
  const p: FinancialProfile = { ...CLEAN, liquidSavingsMinor: 400_000 };
  assert.ok(idsOf(p, CLEAN_SIGNALS).includes("compounding-frequency"));
});

test("inflation-erodes-idle-cash trips on idle cash below inflation", () => {
  const p: FinancialProfile = { ...CLEAN, liquidSavingsMinor: 1_000_000 };
  const ids = idsOf(p, { ...CLEAN_SIGNALS, cashSavingsRate: 0, inflationRate: 0.03 });
  assert.ok(ids.includes("inflation-erodes-idle-cash"));
});

test("bnpl-is-still-debt trips when a BNPL balance is carried", () => {
  const ids = idsOf(CLEAN, { ...CLEAN_SIGNALS, bnplBalanceMinor: 30_000 });
  assert.ok(ids.includes("bnpl-is-still-debt"));
});

test("bnpl-is-still-debt trips when the operator uses BNPL", () => {
  const ids = idsOf(CLEAN, { ...CLEAN_SIGNALS, usesBnpl: true });
  assert.ok(ids.includes("bnpl-is-still-debt"));
});

test("a profile loaded with problems triggers every gap", () => {
  const p: FinancialProfile = {
    ...CLEAN,
    hasRoleModel: false,
    highCostDebtMinor: 120_000,
    liquidSavingsMinor: 1_500_000,
    monthlyIncomeMinor: 250_000,
    monthlyEssentialSpendMinor: 150_000,
  };
  const signals: KnowledgeSignals = {
    isaUsedFraction: 0,
    registeredToVote: false,
    cashSavingsRate: 0,
    inflationRate: 0.04,
    bnplBalanceMinor: 40_000,
  };
  const ids = idsOf(p, signals);
  for (const gap of KNOWLEDGE_GAP_CATALOGUE) {
    assert.ok(ids.includes(gap.id), `expected gap ${gap.id} to trip`);
  }
});

test("every catalogue gap carries a fact and an action-first correction", () => {
  for (const gap of KNOWLEDGE_GAP_CATALOGUE) {
    assert.ok(gap.misconception.length > 0, `${gap.id} has a misconception`);
    assert.ok(gap.fact.length > 0, `${gap.id} has a fact`);
    assert.ok(gap.action.length > 0, `${gap.id} has an action`);
    // action-first: the correction names a concrete move, not a lecture.
    assert.notEqual(gap.action, gap.fact);
  }
});

test("measured prevalences match the quiz findings", () => {
  const byId = new Map(KNOWLEDGE_GAP_CATALOGUE.map((g) => [g.id, g.prevalence]));
  assert.equal(byId.get("money-isnt-an-asset"), 0.44);
  assert.equal(byId.get("debt-not-prioritised"), 0.76);
  assert.equal(byId.get("isa-allowance-unknown"), 0.39);
  assert.equal(byId.get("credit-score-factors-misunderstood"), 0.6);
  assert.equal(byId.get("compounding-frequency"), 0.35);
  assert.equal(byId.get("inflation-erodes-idle-cash"), 0.3);
  // bnpl-is-still-debt is from the research batch, not the 340-person quiz — no prevalence.
  assert.equal(byId.get("bnpl-is-still-debt"), undefined);
});

test("the catalogue carries every defined gap", () => {
  assert.equal(KNOWLEDGE_GAP_CATALOGUE.length, 7);
});

test("detection is deterministic and sorted by relevance descending", () => {
  const p: FinancialProfile = {
    ...CLEAN,
    hasRoleModel: false,
    highCostDebtMinor: 120_000,
    liquidSavingsMinor: 1_500_000,
  };
  const signals: KnowledgeSignals = {
    isaUsedFraction: 0,
    registeredToVote: false,
    cashSavingsRate: 0,
    inflationRate: 0.04,
  };
  const a = detectKnowledgeGaps(p, signals);
  const b = detectKnowledgeGaps(p, signals);
  assert.deepEqual(a, b); // same input → identical output (incl. order)
  for (let i = 1; i < a.length; i++) {
    assert.ok(a[i - 1].relevance >= a[i].relevance, "relevance is non-increasing");
  }
});

test("detectKnowledgeGaps works with no signals argument (profile-only)", () => {
  const p: FinancialProfile = { ...CLEAN, highCostDebtMinor: 50_000 };
  const ids = detectKnowledgeGaps(p).map((g) => g.id);
  assert.ok(ids.includes("debt-not-prioritised"));
});
