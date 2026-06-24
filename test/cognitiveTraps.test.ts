import { test } from "node:test";
import assert from "node:assert/strict";

import {
  detectTraps,
  TRAP_CATALOGUE,
  type TrapId,
} from "../src/finance/cognitiveTraps.ts";
import type { FinancialProfile } from "../src/finance/profile.ts";

// A deliberately neutral baseline that trips NO trap structurally: secure-ish,
// not anxious, has a role model, stable income, savings already started, surplus.
// Archetypes override only the fields (or pass the marker) that matter.
function profile(over: Partial<FinancialProfile> = {}): FinancialProfile {
  return {
    currency: "GBP",
    monthlyIncomeMinor: 2500_00,
    monthlyEssentialSpendMinor: 1500_00, // healthy surplus
    liquidSavingsMinor: 5000_00, // savings already started
    highCostDebtMinor: 0,
    incomeVolatility: "stable",
    supportNetwork: "strong",
    hasRoleModel: true,
    entitlementsAware: true,
    hasUnclaimedSupport: false,
    hasFormalBanking: true,
    reliesOnInformalCredit: false,
    stage: "established",
    financialAnxiety: "low",
    ...over,
  };
}

function ids(profileOver: Partial<FinancialProfile>, freeText?: string): TrapId[] {
  return detectTraps(profile(profileOver), freeText).map((t) => t.id);
}

test("a clean, secure, calm profile with no markers trips no traps", () => {
  const detected = detectTraps(profile());
  assert.deepEqual(detected, []);
});

test("real-job-unlocks-planning: student with surplus but no savings started", () => {
  // Structural: student stage + surplus + no savings.
  assert.ok(
    ids({ stage: "early-student", liquidSavingsMinor: 0 }).includes(
      "real-job-unlocks-planning",
    ),
  );
  // Marker on an otherwise-clean profile.
  assert.ok(
    ids({}, "I'll sort it out when I get a real job").includes(
      "real-job-unlocks-planning",
    ),
  );
});

test("investing-is-gambling: capacity to invest + no role model, or marker", () => {
  assert.ok(
    ids({ hasRoleModel: false }).includes("investing-is-gambling"),
  );
  assert.ok(
    ids({}, "investing is just gambling to me").includes("investing-is-gambling"),
  );
});

test("instant-gratification-now-plan-later: present-bias student, or marker", () => {
  assert.ok(
    ids({ stage: "early-student", liquidSavingsMinor: 0 }).includes(
      "instant-gratification-now-plan-later",
    ),
  );
  assert.ok(
    ids({}, "I'll plan when I'm older, it works for me now").includes(
      "instant-gratification-now-plan-later",
    ),
  );
});

test("defeatism: essentials exceed income + high anxiety, or marker", () => {
  assert.ok(
    ids({
      monthlyIncomeMinor: 800_00,
      monthlyEssentialSpendMinor: 900_00,
      financialAnxiety: "high",
    }).includes("defeatism"),
  );
  assert.ok(
    ids({}, "I'll never afford a house, what's the point").includes("defeatism"),
  );
});

test("overwhelm-must-do-everything-at-once: anxiety + low awareness, or marker", () => {
  assert.ok(
    ids({ financialAnxiety: "high", entitlementsAware: false }).includes(
      "overwhelm-must-do-everything-at-once",
    ),
  );
  assert.ok(
    ids({}, "there are too many things to consider, I'll make the wrong decision").includes(
      "overwhelm-must-do-everything-at-once",
    ),
  );
});

test("no-financial-family-so-adrift: no role model + no support, or marker", () => {
  assert.ok(
    ids({ hasRoleModel: false, supportNetwork: "none" }).includes(
      "no-financial-family-so-adrift",
    ),
  );
  assert.ok(
    ids({}, "no one taught me this, my parents never talked money").includes(
      "no-financial-family-so-adrift",
    ),
  );
});

test("planning-is-redundant-because-uncertain: irregular income, or marker", () => {
  assert.ok(
    ids({ incomeVolatility: "irregular" }).includes(
      "planning-is-redundant-because-uncertain",
    ),
  );
  assert.ok(
    ids({}, "the future is too uncertain, no point planning").includes(
      "planning-is-redundant-because-uncertain",
    ),
  );
});

test("savvy-means-no-fun: spender with surplus but no savings, or marker", () => {
  // Structural: surplus going entirely to spending (no savings started).
  assert.ok(
    ids({ stage: "early-student", liquidSavingsMinor: 0 }).includes(
      "savvy-means-no-fun",
    ),
  );
  // Marker on an otherwise-clean profile.
  assert.ok(
    ids({}, "I can't enjoy life if I'm always saving — you only live once").includes(
      "savvy-means-no-fun",
    ),
  );
});

test("retirement-distortion: career stage, retirement goal, nothing saved, or marker", () => {
  // Structural: career-stage horizon but no buffer started.
  assert.ok(
    ids({ stage: "early-career", liquidSavingsMinor: 0 }).includes(
      "retirement-distortion",
    ),
  );
  // Marker on an otherwise-clean profile.
  assert.ok(
    ids({}, "I have retirement goals but it's all so far off").includes(
      "retirement-distortion",
    ),
  );
});

test("cant-be-responsible-as-a-student: student stage, or marker", () => {
  // Structural: the student identity the belief gates on.
  assert.ok(
    ids({ stage: "early-student" }).includes(
      "cant-be-responsible-as-a-student",
    ),
  );
  // Marker on an otherwise-clean profile.
  assert.ok(
    ids({}, "there's no way to be responsible as a student").includes(
      "cant-be-responsible-as-a-student",
    ),
  );
});

test("all-debt-is-bad: no high-cost debt + student, or marker", () => {
  // Structural: fears debt as a category while carrying none — a student.
  assert.ok(
    ids({ stage: "early-student", highCostDebtMinor: 0 }).includes(
      "all-debt-is-bad",
    ),
  );
  // Marker on an otherwise-clean profile.
  assert.ok(
    ids({}, "all debt is bad, I'll never go into debt").includes(
      "all-debt-is-bad",
    ),
  );
});

test("system-rigged-against-students: student with unclaimed support, or marker", () => {
  // Structural: a student with free wins left on the table.
  assert.ok(
    ids({ stage: "early-student", hasUnclaimedSupport: true }).includes(
      "system-rigged-against-students",
    ),
  );
  // Marker on an otherwise-clean profile.
  assert.ok(
    ids({}, "the system is rigged against students, why even try").includes(
      "system-rigged-against-students",
    ),
  );
});

test("degree-guarantees-job: student banking on the degree, or marker", () => {
  // Structural: student with capacity but nothing started, waiting on graduation.
  assert.ok(
    ids({ stage: "late-student", liquidSavingsMinor: 0 }).includes(
      "degree-guarantees-job",
    ),
  );
  // Marker on an otherwise-clean profile.
  assert.ok(
    ids({}, "my degree will get me a job once I graduate").includes(
      "degree-guarantees-job",
    ),
  );
});

test("every detected trap carries an action-first counter and evidence", () => {
  const detected = detectTraps(
    profile({
      stage: "early-student",
      liquidSavingsMinor: 0,
      hasRoleModel: false,
      financialAnxiety: "high",
    }),
    "investing is gambling and there are too many things to consider",
  );
  assert.ok(detected.length > 0);
  for (const t of detected) {
    assert.ok(t.counter.length > 0, `${t.id} has a counter`);
    // Action-first: counters propose a concrete step, not a lecture.
    assert.ok(t.evidence.length > 0, `${t.id} carries evidence`);
    assert.ok(t.relevance > 0 && t.relevance <= 100);
  }
});

test("results are sorted by relevance (descending)", () => {
  const detected = detectTraps(
    profile({
      stage: "early-student",
      liquidSavingsMinor: 0,
      hasRoleModel: false,
      supportNetwork: "none",
    }),
    "no one taught me this", // boosts no-financial-family to a marker hit
  );
  for (let i = 1; i < detected.length; i++) {
    assert.ok(detected[i - 1].relevance >= detected[i].relevance);
  }
});

test("a marker match outweighs a clean profile (markers always surface)", () => {
  // Clean profile, single marker → exactly that trap surfaces.
  const detected = detectTraps(profile(), "investing is gambling");
  assert.equal(detected.length, 1);
  assert.equal(detected[0].id, "investing-is-gambling");
  assert.ok(detected[0].relevance >= 50);
});

test("the catalogue exposes all thirteen traps with counters, no detection state", () => {
  assert.equal(TRAP_CATALOGUE.length, 13);
  const expected: TrapId[] = [
    "real-job-unlocks-planning",
    "investing-is-gambling",
    "instant-gratification-now-plan-later",
    "defeatism",
    "overwhelm-must-do-everything-at-once",
    "no-financial-family-so-adrift",
    "planning-is-redundant-because-uncertain",
    "savvy-means-no-fun",
    "retirement-distortion",
    "cant-be-responsible-as-a-student",
    "all-debt-is-bad",
    "system-rigged-against-students",
    "degree-guarantees-job",
  ];
  assert.deepEqual(
    TRAP_CATALOGUE.map((t) => t.id),
    expected,
  );
  for (const t of TRAP_CATALOGUE) {
    assert.ok(t.belief.length > 0);
    assert.ok(t.counter.length > 0);
    assert.ok(t.markers.length > 0);
    assert.ok(!("relevance" in t));
    assert.ok(!("evidence" in t));
  }
});

test("determinism: same inputs yield identical output", () => {
  const p = profile({ stage: "early-student", liquidSavingsMinor: 0, hasRoleModel: false });
  const txt = "no one taught me and investing is gambling";
  assert.deepEqual(detectTraps(p, txt), detectTraps(p, txt));
});
