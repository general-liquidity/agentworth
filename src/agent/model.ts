import type { PaymentIntentDraft } from "./schema.ts";
import type { PayeeScope, Period, RailKind } from "../core/types.ts";

/** What the agent is told about the operator's standing authority, so it can
 * propose payments that fit (it still cannot exceed them — the gate enforces). */
export interface MandateSummary {
  id: string;
  label: string;
  scope: PayeeScope;
  currency: string;
  allowedRails: RailKind[];
  perTxCap: number;
  perPeriodCap: number;
  period: Period;
}

export interface AgentContext {
  mandates: MandateSummary[];
}

export type ModelDecision =
  | { kind: "pay"; draft: PaymentIntentDraft }
  | { kind: "message"; message: string };

/** Model-agnostic provider (the Hermes lesson: no provider lock-in). A
 * deterministic stub backs the tests + air-gapped CLI; the real agent runs on
 * the Vercel AI SDK (see aiAgent.ts / aiSdkModel.ts). */
export interface ModelProvider {
  propose(goal: string, ctx: AgentContext): Promise<ModelDecision>;
}
