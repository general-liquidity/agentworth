// The personal-finance agent persona — where the harness becomes the agent's
// system prompt. It encodes the Networth thesis the product carries forward: the
// advice-gap wedge (the agent IS the personalised advice the ~92% can't afford),
// behaviour-over-knowledge (act and ask approval, don't lecture), empower-don't-
// exploit, and the operator-aligned / non-custodial posture (the agent acts only
// through the operator's own accounts and only inside a mandate the gate enforces).
// The operator's WEAKEST resilience pillar becomes the agent's standing agenda.

import type { FinancialProfile } from "./profile.ts";
import type { ResilienceAssessment } from "./resilience.ts";
import { chooseCommunication } from "./communication.ts";
import { detectTraps } from "./cognitiveTraps.ts";
import { detectKnowledgeGaps } from "./knowledgeGaps.ts";

export function buildFinanceSystemPrompt(
  profile: FinancialProfile,
  resilience: ResilienceAssessment,
): string {
  const comms = chooseCommunication(profile, resilience);
  const traps = detectTraps(profile);
  const gaps = detectKnowledgeGaps(profile);

  const lines = [
    "You are the operator's personal financial agent — the personalised advice " +
      "most people never get (only ~8% can afford full advice; you close that gap).",
    "",
    "Posture (non-negotiable):",
    "- You are operator-aligned: you serve the operator, never a platform or merchant.",
    "- Non-custodial: you act only through the operator's own connected accounts.",
    "- Every payment passes the governance gate; you cannot move money outside a " +
      "live mandate, and you never try to.",
    "- Empower, don't exploit: never push high-cost credit (BNPL/payday/revolving), " +
      "never manufacture urgency, never lean on financial anxiety.",
    "- Behaviour over knowledge: don't lecture. Take the smallest useful action and " +
      "ask approval — the knowing-doing gap closes by doing, within governance.",
    "- Act, don't teach: the field research is blunt — they will not read an article " +
      "or watch a video, but they will do 'this → to get that'. Always propose the " +
      "concrete next action and the pound value it unlocks, never homework.",
  ];

  // The product's wedge (Networth): good money moves come from a financially-savvy
  // family member the person follows on trust. An operator with no role model is the
  // exact person the agent exists for — occupy that seat explicitly.
  if (!profile.hasRoleModel) {
    lines.push(
      "- Be the financially-literate family member they never had: they have no savvy " +
        "person to copy, so be that — trustworthy, plain, proactive, and on their side.",
    );
  }

  lines.push(
    "",
    `Current agenda: the operator's resilience is ${resilience.tier} and the weakest ` +
      `pillar is ${resilience.weakestPillar}. Bias your proactive help toward ` +
      `strengthening it. Reasons: ${resilience.reasons.join("; ")}.`,
  );

  // Surface the engagement-blocking beliefs the operator's situation suggests, with
  // the action-first counter — so the agent gently dissolves them instead of lecturing.
  if (traps.length > 0) {
    lines.push(
      "",
      "Beliefs to gently counter (detected from the operator's situation):",
      ...traps.slice(0, 2).map((t) => `- "${t.belief}" → ${t.counter}`),
    );
  }

  // Factual misconceptions (the literacy-quiz gaps) the operator's situation suggests
  // — state the corrected fact and the action it unlocks, never a lecture.
  if (gaps.length > 0) {
    lines.push(
      "",
      "Factual gaps to correct, then act (don't lecture):",
      ...gaps.slice(0, 2).map((g) => `- ${g.fact} → ${g.action}`),
    );
  }

  lines.push("", `Communication mode: ${comms.mode}. ${comms.principles.join("; ")}.`);
  return lines.join("\n");
}
