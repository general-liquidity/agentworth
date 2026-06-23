// Cognitive traps — the named false beliefs that block engagement. Networth's
// 19 in-depth student interviews surfaced the same handful of beliefs over and
// over: students KNOW what to do and WANT to, but DON'T. The bottleneck is
// activation energy + a trusted nudge, NOT information. So each trap pairs a
// deterministic detection signal (over FinancialProfile fields + optional
// free-text markers the caller may pass) with an ACTION-FIRST counter — the
// smallest concrete next step the agent does/proposes, never a lecture or a sell.
//
// Detection is intentionally generous: a marker phrase OR a structural profile
// signal trips the trap. Markers come from what the operator actually said;
// the profile signals catch the trap even when it's unspoken. Pure + deterministic.

import type { FinancialProfile } from "./profile.ts";
import { monthlySurplusMinor } from "./profile.ts";

export type TrapId =
  | "real-job-unlocks-planning"
  | "investing-is-gambling"
  | "instant-gratification-now-plan-later"
  | "defeatism"
  | "overwhelm-must-do-everything-at-once"
  | "no-financial-family-so-adrift"
  | "planning-is-redundant-because-uncertain";

export interface TrapDefinition {
  id: TrapId;
  /** The false belief in plain words — how the student actually phrases it. */
  belief: string;
  /** Free-text phrases that, if present in operator input, trip the trap. */
  markers: string[];
  /** The smallest concrete next step the agent does/proposes — not a lecture. */
  counter: string;
}

export interface DetectedTrap extends TrapDefinition {
  /** 0–100: how strongly this profile/markers indicate the trap is active. */
  relevance: number;
  /** Why it tripped — the structural signal and/or the marker that matched. */
  evidence: string[];
}

/** Per-trap deterministic signal over the profile. Returns a structural score
 * (0–100) and the reasons; markers add to this in detectTraps. A score of 0
 * means no structural signal (the trap can still trip purely on a marker). */
type ProfileSignal = (p: FinancialProfile) => { score: number; reasons: string[] };

interface TrapSpec extends TrapDefinition {
  signal: ProfileSignal;
}

// --- Trap specifications -----------------------------------------------------

const SPECS: TrapSpec[] = [
  {
    // Interview pattern: the single biggest engagement-killer — "I'll start
    // planning properly once I have a real, full-time salary." It defers
    // everything to a future that keeps moving. Counter: the smallest thing
    // that can start TODAY with what they already have.
    id: "real-job-unlocks-planning",
    belief: "I'll start planning when I have a real job / proper salary.",
    markers: [
      "real job",
      "proper job",
      "real salary",
      "proper salary",
      "full-time job",
      "full time job",
      "when i graduate",
      "after uni",
      "after university",
      "once i'm earning properly",
      "when i earn more",
    ],
    counter:
      "Start one tiny thing today: set up £20/mo into the LISA you already have — it doesn't wait for a salary.",
    signal: (p) => {
      const reasons: string[] = [];
      let score = 0;
      // Students/early-career who could spare a little but haven't built any buffer.
      if (p.stage === "early-student" || p.stage === "late-student") {
        score += 40;
        reasons.push("student stage — most prone to deferring to 'a real job'");
      } else if (p.stage === "early-career") {
        score += 20;
        reasons.push("early-career — the 'when it's a real job' bar keeps moving");
      }
      if (monthlySurplusMinor(p) > 0 && p.liquidSavingsMinor <= 0) {
        score += 35;
        reasons.push("has monthly surplus but no savings started yet");
      }
      return { score, reasons };
    },
  },
  {
    // Interview pattern: "investing is just gambling" — conflated with day-trading;
    // risk-aversion born of not understanding, not of preference. Counter: ONE
    // low-risk, education-by-doing step, not a lecture on diversification.
    id: "investing-is-gambling",
    belief: "Investing is basically gambling.",
    markers: [
      "investing is gambling",
      "gambling",
      "like betting",
      "it's a gamble",
      "could lose it all",
      "too risky",
      "rather not risk",
      "stock market is rigged",
    ],
    counter:
      "Try one low-risk step to learn by doing: put a small amount into a broad, low-cost index fund inside your ISA — chosen for understanding, not a bet.",
    signal: (p) => {
      const reasons: string[] = [];
      let score = 0;
      // Risk-aversion from non-understanding: no one explained investing (no role
      // model) is the core signal. Capacity to invest only sharpens it — having
      // capacity alone is not evidence of the belief, so it never trips on its own.
      if (!p.hasRoleModel) {
        score += 30;
        reasons.push("no role model — investing left unexplained, read as gambling");
        if (monthlySurplusMinor(p) > 0 && p.liquidSavingsMinor > 0) {
          score += 15;
          reasons.push("has capacity to invest but likely sitting entirely in cash");
        }
      }
      return { score, reasons };
    },
  },
  {
    // Interview pattern: present-bias — "it works for me now, I'll plan when I'm
    // older." The present self keeps winning the choice. Counter: REMOVE the
    // choice from the present self — automate one small recurring transfer.
    id: "instant-gratification-now-plan-later",
    belief: "It works for me now — I'll plan when I'm older.",
    markers: [
      "plan when i'm older",
      "plan when im older",
      "i'll plan later",
      "ill plan later",
      "works for me now",
      "enjoy it now",
      "live in the moment",
      "deal with it later",
      "future me",
      "i'm young",
      "im young",
    ],
    counter:
      "Automate it so today-you never has to choose: set one small recurring transfer (e.g. £10/week) to savings on payday — reversible any time.",
    signal: (p) => {
      const reasons: string[] = [];
      let score = 0;
      if (p.stage === "early-student" || p.stage === "late-student") {
        score += 25;
        reasons.push("early life-stage — present-bias is strongest here");
      }
      if (monthlySurplusMinor(p) > 0 && p.liquidSavingsMinor <= 0) {
        score += 30;
        reasons.push("spending the surplus instead of moving a slice aside");
      }
      return { score, reasons };
    },
  },
  {
    // Interview pattern: defeatism — "a house / retirement is just impossible, so
    // why bother." Distinct from overwhelm: it's hopelessness about the GOAL, not
    // confusion about the steps. Counter: one attainable NEAR-TERM win + proof.
    id: "defeatism",
    belief: "None of it is attainable, so it's not worth trying.",
    markers: [
      "never afford",
      "never going to afford",
      "impossible",
      "no point",
      "what's the point",
      "whats the point",
      "pointless",
      "never own a house",
      "can't afford",
      "cant afford",
      "give up",
      "not worth trying",
      "rigged against",
    ],
    counter:
      "Pick one attainable near-term win — e.g. a £100 starter buffer in 6 weeks — and I'll show you the weekly amount that gets there. Proof it's possible beats the big number.",
    signal: (p) => {
      const reasons: string[] = [];
      let score = 0;
      // Genuinely tight conditions feed defeatism; high anxiety amplifies it.
      if (monthlySurplusMinor(p) <= 0) {
        score += 35;
        reasons.push("essentials meet or exceed income — fuels 'it's impossible'");
      }
      if (p.financialAnxiety === "high") {
        score += 25;
        reasons.push("high anxiety — predicts hopeless framing");
      }
      if (p.highCostDebtMinor > 0) {
        score += 10;
        reasons.push("carrying high-cost debt — feeds the 'no point' belief");
      }
      return { score, reasons };
    },
  },
  {
    // Interview pattern: overwhelm — "there are too many things to consider, I'll
    // make the wrong decision, so I freeze." It's decision paralysis, not
    // hopelessness. Counter: collapse everything to ONE next action.
    id: "overwhelm-must-do-everything-at-once",
    belief: "There's too much to consider — I'll just make the wrong decision.",
    markers: [
      "too many things",
      "too much to",
      "overwhelmed",
      "overwhelming",
      "don't know where to start",
      "dont know where to start",
      "wrong decision",
      "so many options",
      "too complicated",
      "paralysed",
      "paralyzed",
      "freeze",
    ],
    counter:
      "Ignore everything except one thing: the single highest-impact next action right now is the only decision you need to make. I'll sequence the rest behind it.",
    signal: (p) => {
      const reasons: string[] = [];
      let score = 0;
      if (p.financialAnxiety === "high" || p.financialAnxiety === "moderate") {
        score += 25;
        reasons.push("anxiety present — overwhelm and avoidance co-occur");
      }
      if (!p.entitlementsAware) {
        score += 15;
        reasons.push("low awareness — the option-space reads as unmanageably large");
      }
      return { score, reasons };
    },
  },
  {
    // Interview pattern: "good money moves come from having a financially-literate
    // parent; I don't have one, so I'm adrift." Lack of a trusted advisor, not lack
    // of capacity. Counter: the agent explicitly occupies that trusted-advisor seat.
    id: "no-financial-family-so-adrift",
    belief: "Good money moves come from a savvy parent — I don't have one, so I'm adrift.",
    markers: [
      "no one taught me",
      "nobody taught me",
      "parents never",
      "my parents don't",
      "my parents dont",
      "no one in my family",
      "nobody to ask",
      "no one to ask",
      "adrift",
      "figuring it out alone",
      "on my own with this",
      "wasn't taught",
      "wasnt taught",
    ],
    counter:
      "You don't need a savvy parent — I'll be that seat. Tell me the one decision in front of you and I'll give you the move I'd give family.",
    signal: (p) => {
      const reasons: string[] = [];
      let score = 0;
      if (!p.hasRoleModel) {
        score += 45;
        reasons.push("no financial role model — the exact 'adrift' condition");
      }
      if (p.supportNetwork === "none") {
        score += 20;
        reasons.push("no support network to fall back on");
      }
      return { score, reasons };
    },
  },
  {
    // Interview pattern: "the future's too uncertain to plan, so planning is
    // pointless." Uncertainty is used to justify doing nothing. Counter: a rough,
    // adaptable plan beats none — small REVERSIBLE steps you adjust as you go.
    id: "planning-is-redundant-because-uncertain",
    belief: "The future's too uncertain — planning is pointless.",
    markers: [
      "too uncertain",
      "future is uncertain",
      "who knows what",
      "can't predict",
      "cant predict",
      "anything could happen",
      "no point planning",
      "no point in planning",
      "plans never work out",
      "things change",
    ],
    counter:
      "A rough, adaptable plan beats none. Let's take one small reversible step now (e.g. a flexible auto-save you can pause), and adjust as things change — no crystal ball needed.",
    signal: (p) => {
      const reasons: string[] = [];
      let score = 0;
      // Genuine income instability is the rational-sounding cover for this trap.
      if (p.incomeVolatility === "irregular") {
        score += 35;
        reasons.push("irregular income — uncertainty used to justify no plan");
      } else if (p.incomeVolatility === "variable") {
        score += 20;
        reasons.push("variable income — 'too uncertain to plan' rationalisation");
      }
      return { score, reasons };
    },
  },
];

/** The full catalogue of traps with their action-first counters (no detection). */
export const TRAP_CATALOGUE: readonly TrapDefinition[] = SPECS.map(
  ({ signal: _signal, ...def }) => def,
);

const MARKER_WEIGHT = 50; // a matched marker is strong, direct evidence
const RELEVANCE_FLOOR = 20; // below this, the structural signal is too weak to surface

function normalise(text: string): string {
  return text.toLowerCase();
}

/**
 * Detect the cognitive traps active for this operator. A trap surfaces when the
 * operator's words match a marker (strong signal) OR the profile structurally
 * indicates it (RELEVANCE_FLOOR). Returns the detected traps sorted by relevance
 * (descending). Deterministic — same inputs, same output, same order.
 */
export function detectTraps(
  profile: FinancialProfile,
  freeText?: string,
): DetectedTrap[] {
  const haystack = freeText ? normalise(freeText) : "";
  const detected: DetectedTrap[] = [];

  for (const spec of SPECS) {
    const { signal, ...def } = spec;
    const { score: structural, reasons } = signal(profile);

    const matchedMarkers = haystack
      ? def.markers.filter((m) => haystack.includes(m))
      : [];
    const markerScore = matchedMarkers.length > 0 ? MARKER_WEIGHT : 0;

    const relevance = Math.min(100, structural + markerScore);
    const tripped = matchedMarkers.length > 0 || structural >= RELEVANCE_FLOOR;
    if (!tripped) continue;

    const evidence = [...reasons];
    for (const m of matchedMarkers) {
      evidence.push(`operator said: "${m}"`);
    }

    detected.push({ ...def, relevance, evidence });
  }

  // Sort by relevance desc; ties broken by catalogue order for determinism.
  const order = new Map(SPECS.map((s, i) => [s.id, i]));
  detected.sort(
    (a, b) => b.relevance - a.relevance || order.get(a.id)! - order.get(b.id)!,
  );
  return detected;
}
