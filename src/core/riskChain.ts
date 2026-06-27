import type { AuditEntry } from "./audit.ts";
import type { PaymentIntent } from "./types.ts";

export interface RiskChainAlert {
  triggered: boolean;
  type: "NONE" | "SMURFING" | "PROBING" | "SPLITTING" | "DRAIN_AFTER_GRANT";
  reason?: string;
}

/**
 * Stateful risk-chain tracker that inspects recent audit logs to identify
 * multi-step spend exfiltration patterns (smurfing or mandate probing).
 */
export function evaluateRiskChain(
  intent: PaymentIntent,
  entries: readonly AuditEntry[],
  opts: {
    isStreaming?: boolean;
    windowMinutes?: number;
    now?: string;
    /** fraction of a mandate's available period budget a single payment must
     * consume to count as a drain. Default 0.8 (>= 80%). */
    drainFraction?: number;
    /** how soon after a mandate is granted a drain must land to trigger, in
     * minutes. Default 60. */
    drainAfterGrantMinutes?: number;
  } = {},
): RiskChainAlert {
  const windowMinutes = opts.windowMinutes ?? 15;
  // Anchor the window on the executor's TRUSTED clock (`opts.now`), not the
  // agent-supplied `intent.createdAt` — an agent could future-date createdAt to
  // push the window past every real audit entry and slip this detector.
  const nowMs = new Date(opts.now ?? intent.createdAt).getTime();
  const windowMs = windowMinutes * 60 * 1000;
  const startMs = nowMs - windowMs;

  // Filter gate decisions in the window
  const recentDecisions = entries
    .filter((e) => e.type === "gate.decision" && new Date(e.ts).getTime() >= startMs)
    .map((e) => e.payload as any)
    .filter((p) => p && typeof p === "object" && p.intent);

  // 1. Micropayment Slicing / Smurfing detection (bypassed for streaming mandates):
  if (!opts.isStreaming) {
    const samePayeeDecisions = recentDecisions.filter(
      (d) => d.intent.payee === intent.payee && d.outcome === "auto_execute",
    );

    if (samePayeeDecisions.length >= 3) {
      const totalAmount =
        samePayeeDecisions.reduce((sum, d) => sum + d.intent.amount, 0) + intent.amount;
      return {
        triggered: true,
        type: "SMURFING",
        reason:
          `Smurfing/Slicing alert: ${samePayeeDecisions.length + 1} auto-executed payments ` +
          `to "${intent.payee}" within ${windowMinutes}m, totaling ${totalAmount} minor-units.`,
      };
    }
  }

  // 1b. Cross-rail splitting: the same payee auto-executed across >=2 distinct
  // rails in the window - fragmenting a spend across rails to dodge per-rail or
  // per-mandate caps. Catches the 2-3 payment case that slips under the smurfing
  // count. Bypassed for streaming mandates (like smurfing).
  if (!opts.isStreaming) {
    const samePayeeAuto = recentDecisions.filter(
      (d) => d.intent.payee === intent.payee && d.outcome === "auto_execute",
    );
    const rails = new Set<string>(samePayeeAuto.map((d) => d.intent.rail));
    rails.add(intent.rail);
    if (samePayeeAuto.length >= 2 && rails.size >= 2) {
      const totalAmount =
        samePayeeAuto.reduce((sum, d) => sum + d.intent.amount, 0) + intent.amount;
      return {
        triggered: true,
        type: "SPLITTING",
        reason:
          `Cross-rail splitting alert: payments to "${intent.payee}" spread across ` +
          `${rails.size} rails within ${windowMinutes}m, totaling ${totalAmount} minor-units.`,
      };
    }
  }

  // 2. Mandate Bypass Probing:
  // Detect if the agent is repeatedly testing different payees/classes to find active mandates
  const nonAllowedDecisions = recentDecisions.filter(
    (d) => d.outcome === "block" || d.outcome === "confirm_operator",
  );
  const distinctPayees = new Set(nonAllowedDecisions.map((d) => d.intent.payee));
  distinctPayees.add(intent.payee);

  if (nonAllowedDecisions.length >= 4 && distinctPayees.size >= 2) {
    return {
      triggered: true,
      type: "PROBING",
      reason:
        `Probing/Scan alert: ${nonAllowedDecisions.length} blocked or pending payment intents ` +
        `across ${distinctPayees.size} distinct payees within ${windowMinutes}m.`,
    };
  }

  // 3. Drain-after-grant:
  // A single payment that consumes most (>= drainFraction) of a mandate's
  // available period budget very soon after that mandate was granted. The classic
  // "grant me a budget, then immediately empty it" abuse. We correlate the signed
  // `gate.decision` entries (which carry the authorizing mandateId + the verdict's
  // remainingPeriodBudget) against the `mandate.granted` entries, using each
  // grant's audit timestamp as the grant time. If no matching grant is present in
  // the audit we do NOT trigger — escalate-only means we never manufacture a
  // false positive from missing provenance.
  const drainFraction = opts.drainFraction ?? 0.8;
  const drainAfterGrantMs = (opts.drainAfterGrantMinutes ?? 60) * 60 * 1000;

  const latestGrantTsBefore = (mandateId: string, beforeMs: number): number | null => {
    let latest: number | null = null;
    for (const e of entries) {
      if (e.type !== "mandate.granted") continue;
      const p = e.payload as any;
      if (!p || p.id !== mandateId) continue;
      const t = new Date(e.ts).getTime();
      if (t <= beforeMs && (latest === null || t > latest)) latest = t;
    }
    return latest;
  };

  for (const e of entries) {
    if (e.type !== "gate.decision") continue;
    const tMs = new Date(e.ts).getTime();
    if (tMs < startMs) continue; // anchored on opts.now via startMs
    const p = e.payload as any;
    if (!p || typeof p !== "object" || !p.intent) continue;
    const mandateId = p.mandateId;
    if (!mandateId) continue;
    const remaining = p.verdict?.remainingPeriodBudget;
    if (typeof remaining !== "number") continue;
    const amount = p.intent.amount;
    const budgetBefore = amount + remaining; // remaining is AFTER this payment
    if (budgetBefore <= 0) continue;
    const fraction = amount / budgetBefore;
    if (fraction < drainFraction) continue;
    const grantTs = latestGrantTsBefore(mandateId, tMs);
    if (grantTs === null) continue;
    if (tMs - grantTs > drainAfterGrantMs) continue;
    const minutesAfter = Math.round((tMs - grantTs) / 60000);
    return {
      triggered: true,
      type: "DRAIN_AFTER_GRANT",
      reason:
        `Drain-after-grant alert: payment of ${amount} minor-units consumed ` +
        `${Math.round(fraction * 100)}% of mandate "${mandateId}"'s available period budget ` +
        `${minutesAfter}m after it was granted.`,
    };
  }

  return { triggered: false, type: "NONE" };
}
