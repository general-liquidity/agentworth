import { test } from "node:test";
import assert from "node:assert/strict";

import { peerNudges, type CohortBenchmark } from "../src/finance/peerNudge.ts";
import type { FinancialProfile } from "../src/finance/profile.ts";

// A baseline second-year-student profile: modest surplus, thin buffer.
function baseProfile(over: Partial<FinancialProfile> = {}): FinancialProfile {
  return {
    currency: "GBP",
    monthlyIncomeMinor: 110_000, // £1,100
    monthlyEssentialSpendMinor: 100_000, // £1,000 → £100 surplus (below £150 peer)
    liquidSavingsMinor: 45_000, // £450 → 0.45 months buffer (below 2-month peer)
    highCostDebtMinor: 0,
    incomeVolatility: "variable",
    supportNetwork: "some",
    hasRoleModel: false,
    entitlementsAware: false,
    hasUnclaimedSupport: false,
    hasFormalBanking: true,
    reliesOnInformalCredit: false,
    stage: "late-student",
    financialAnxiety: "moderate",
    ...over,
  };
}

const COHORT: CohortBenchmark = {
  label: "second-year students",
  medianMonthlySaveMinor: 15_000, // £150/mo
  fractionWithIsaOrLisa: 0.6, // a majority — the norm
  medianEmergencyBufferMonths: 2,
};

// The words a social-proof nudge must NEVER use — the boomerang/shame failure
// mode the research and ethics.ts both forbid.
const FORBIDDEN = [
  "should",
  "shouldn't",
  "guilt",
  "ashamed",
  "shame",
  "behind everyone",
  "falling behind",
  "lazy",
  "irresponsible",
  "failing",
  "bad with money",
  "too little",
  "not enough",
  "must ",
];

function assertNoShame(text: string): void {
  const lower = text.toLowerCase();
  for (const word of FORBIDDEN) {
    assert.ok(!lower.includes(word), `nudge copy contains forbidden/shaming phrase "${word}": ${text}`);
  }
}

test("below-benchmark operator gets encouraging, action-first nudges (no shame)", () => {
  const nudges = peerNudges(baseProfile(), COHORT);

  // Below on all three dimensions → three "below" nudges.
  assert.ok(nudges.length >= 3, "expected a nudge per below-benchmark dimension");

  const save = nudges.find((n) => n.dimension === "monthly_save");
  assert.ok(save, "expected a monthly-save nudge");
  assert.equal(save.id, "monthly_save:below");
  assert.ok(save.gap > 0, "below-benchmark gap should be positive");

  for (const n of nudges) {
    // Action-first: every nudge carries a concrete action and possibility framing.
    assert.ok(n.action.length > 0, "every nudge must carry an action");
    assert.ok(n.framing.length > 0, "every nudge must carry framing");
    // Possibility-framed, social-proof present.
    assert.ok(/students like you|second-year students/i.test(n.peerFact), "peerFact names the cohort");
    assertNoShame(n.peerFact);
    assertNoShame(n.action);
    assertNoShame(n.framing);
  }

  // The framing is genuinely encouraging on at least the save dimension.
  assert.match(save.framing, /you're close/i);
});

test("at-or-above operator is affirmed, never made to feel inadequate", () => {
  // Strong operator: big surplus, full buffer, ISA already open.
  const strong = baseProfile({
    monthlyIncomeMinor: 300_000,
    monthlyEssentialSpendMinor: 100_000, // £2,000 surplus
    liquidSavingsMinor: 400_000, // 4 months buffer (cohort wants 2)
    entitlementsAware: true,
  });
  const nudges = peerNudges(strong, COHORT);

  // No "below" nudges — only affirmations.
  for (const n of nudges) {
    assert.ok(n.id.endsWith(":affirm"), `expected only affirmations, got ${n.id}`);
    assert.equal(n.gap, 0, "affirmations carry no gap");
    assertNoShame(n.framing);
    assertNoShame(n.action);
  }
  assert.ok(nudges.length >= 1, "an ahead operator still gets affirmed, not silence-by-inadequacy");
});

test("quality-of-life flag softens the save-more nudge", () => {
  const profile = baseProfile();
  const hard = peerNudges(profile, COHORT);
  const soft = peerNudges(profile, COHORT, { valuesQualityOfLife: true });

  const hardSave = hard.find((n) => n.dimension === "monthly_save");
  const softSave = soft.find((n) => n.dimension === "monthly_save");
  assert.ok(hardSave && softSave, "both modes produce a save nudge");

  // The softened nudge is a distinct, gentler variant — not a thrift push.
  assert.equal(softSave.id, "monthly_save:below_soft");
  assert.notEqual(softSave.id, hardSave.id);
  assert.match(softSave.action, /no change needed|on your terms|whenever/i);
  assert.match(softSave.framing, /fine choice|not a target|on your terms/i);
  assertNoShame(softSave.action);
  assertNoShame(softSave.framing);

  // The social proof is still present (informing is empowering); only the push is gone.
  assert.match(softSave.peerFact, /second-year students/i);
});

test("deterministic ordering by closeable impact (largest gap first)", () => {
  const profile = baseProfile();
  const a = peerNudges(profile, COHORT);
  const b = peerNudges(profile, COHORT);

  // Identical inputs → identical output (pure + deterministic).
  assert.deepEqual(a, b);

  // Sorted by gap desc; ties stable on id.
  for (let i = 1; i < a.length; i++) {
    assert.ok(
      a[i - 1].gap > a[i].gap || (a[i - 1].gap === a[i].gap && a[i - 1].id <= a[i].id),
      "nudges must be ordered by gap desc, id asc on ties",
    );
  }
});

test("does not manufacture inadequacy when cohort benchmarks are zero/empty", () => {
  const emptyCohort: CohortBenchmark = {
    label: "people like you",
    medianMonthlySaveMinor: 0,
    fractionWithIsaOrLisa: 0.2, // below 0.5 → not the norm, no nudge
    medianEmergencyBufferMonths: 0,
  };
  const nudges = peerNudges(baseProfile(), emptyCohort);
  // Nothing to compare against → no nudges, no invented gaps.
  assert.equal(nudges.length, 0);
});
