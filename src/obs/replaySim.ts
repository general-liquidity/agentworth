// Counterfactual policy replay (PayGraph's simulator, on our signed audit chain).
// "If I'd had THIS mandate set / these caps last month, what would have changed?"
// It re-runs the pure gate over the recorded intents (from the enriched
// gate.decision records) against a CANDIDATE mandate set + config + deny-list, and
// reconstructs period budget from what the candidate would have auto-executed.
//
// Scope: it varies mandates/config/deny-list and holds the recorded external
// inputs (reversibility/attestation/reputation/trust) fixed as-of-decision — a
// clean "what would a different policy have done in the same world" counterfactual.

import { evaluateGate } from "../core/gate.ts";
import { periodStart } from "../core/store.ts";
import { DEFAULT_DENY_RULES } from "../core/denyList.ts";
import {
  DEFAULT_GATE_CONFIG,
  type Attestation,
  type DenyRule,
  type GateConfig,
  type GateContext,
  type GateOutcome,
  type Mandate,
  type PaymentIntent,
  type PriorSpend,
  type ReputationLevel,
  type Reversibility,
} from "../core/types.ts";
import type { AuditEntry } from "../core/audit.ts";
import type { TrustLevel } from "../core/trust.ts";

interface DecisionPayload {
  intentId: string;
  phase?: string;
  outcome: GateOutcome;
  intent?: PaymentIntent;
  inputs?: {
    reversibility?: Reversibility;
    attestation?: Attestation;
    reputation?: ReputationLevel;
    trust?: TrustLevel;
  };
}

export interface ReplayCandidate {
  mandates: Mandate[];
  config?: GateConfig;
  denyRules?: DenyRule[];
}

export interface ReplayRecord {
  intentId: string;
  original: GateOutcome;
  replayed: GateOutcome;
  changed: boolean;
}

export interface ReplayReport {
  total: number;
  unchanged: number;
  changed: number;
  records: ReplayRecord[];
}

export function replayAudit(
  entries: readonly AuditEntry[],
  candidate: ReplayCandidate,
): ReplayReport {
  const config = candidate.config ?? DEFAULT_GATE_CONFIG;
  const denyRules = candidate.denyRules ?? DEFAULT_DENY_RULES;
  // Counterfactual period spend: what the CANDIDATE would have auto-executed.
  const settledByMandate = new Map<string, PriorSpend[]>();
  const records: ReplayRecord[] = [];

  const decisions = entries.filter((e): e is AuditEntry => {
    if (e.type !== "gate.decision") return false;
    const p = e.payload as DecisionPayload;
    return p.phase === "agent" && p.intent !== undefined;
  });

  for (const entry of decisions) {
    const p = entry.payload as DecisionPayload;
    const intent = p.intent as PaymentIntent;
    const inputs = p.inputs ?? {};
    const recordedTrust: TrustLevel = inputs.trust ?? "new";

    const ctx: GateContext = {
      now: intent.createdAt,
      mandates: candidate.mandates,
      periodSpendByMandate: (id) => {
        const m = candidate.mandates.find((x) => x.id === id);
        if (!m) return [];
        const start = periodStart(intent.createdAt, m.period);
        return (settledByMandate.get(id) ?? []).filter((s) => s.at >= start);
      },
      // knownPayees feeds the irreversible-to-unknown deny rule. A recorded trust
      // of "seen"/"trusted" means the payee HAD settled history at decision time,
      // i.e. was a known payee — reconstruct that membership from the snapshot.
      knownPayees: recordedTrust === "new" ? new Set() : new Set([intent.payee]),
      trustOf: () => recordedTrust,
      reputationOf: inputs.reputation ? () => inputs.reputation : undefined,
      attestation: inputs.attestation,
      reversibility: inputs.reversibility,
      denyRules,
      config,
    };

    const decision = evaluateGate(intent, ctx);
    if (decision.outcome === "auto_execute" && decision.mandateId) {
      const arr = settledByMandate.get(decision.mandateId) ?? [];
      arr.push({ amount: intent.amount, at: intent.createdAt });
      settledByMandate.set(decision.mandateId, arr);
    }

    records.push({
      intentId: intent.id,
      original: p.outcome,
      replayed: decision.outcome,
      changed: p.outcome !== decision.outcome,
    });
  }

  const changed = records.filter((r) => r.changed).length;
  return { total: records.length, unchanged: records.length - changed, changed, records };
}
