// Hot-tier memory (the Hermes pattern). A small, ALWAYS-injected snapshot of the
// live trust state — active mandates, resilience, halt status, recent payees — so
// the agent reasons against current reality every turn. Capped (Hermes's MEMORY.md
// discipline) so it never crowds out the task. The cold tier (full history) is
// reached on demand via the `recall` tool, not injected.

import type { Mandate } from "../core/types.ts";
import type { ResilienceAssessment } from "./resilience.ts";

export const HOT_TIER_MAX_CHARS = 2200;

export interface HotTierInput {
  mandates: Pick<
    Mandate,
    "label" | "currency" | "allowedRails" | "perTxCap" | "perPeriodCap" | "period"
  >[];
  resilience: ResilienceAssessment;
  killSwitchEngaged: boolean;
  circuitBreakerOpen: boolean;
  recentPayees: string[];
}

export function buildHotTier(input: HotTierInput, maxChars: number = HOT_TIER_MAX_CHARS): string {
  const lines: string[] = [];
  lines.push(
    `Resilience: ${input.resilience.tier} (weakest pillar: ${input.resilience.weakestPillar}).`,
  );
  if (input.killSwitchEngaged) {
    lines.push("⚠ KILL SWITCH ENGAGED — no payment will execute.");
  }
  if (input.circuitBreakerOpen) {
    lines.push("⚠ CIRCUIT BREAKER OPEN — spend is frozen until reset.");
  }
  if (input.mandates.length === 0) {
    lines.push("Live mandates: none — any payment needs operator confirmation.");
  } else {
    lines.push("Live mandates:");
    for (const m of input.mandates) {
      lines.push(
        `  - ${m.label}: ${m.currency} via ${m.allowedRails.join("/")}, ` +
          `per-tx ${m.perTxCap}, per-${m.period} ${m.perPeriodCap}`,
      );
    }
  }
  if (input.recentPayees.length > 0) {
    lines.push(`Recent payees: ${input.recentPayees.slice(0, 10).join(", ")}.`);
  }
  const text = lines.join("\n");
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}
