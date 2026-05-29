// The agent loop. The model proposes; the harness disposes. The ONLY way this
// loop can move money is by handing a validated PaymentIntent to the executor,
// which forces it through the gate. There is no other spend path — that is the
// whole point of "an agent that structurally can't spend wrong."

import { PaymentIntentDraftSchema } from "./schema.ts";
import type { AgentContext, ModelDecision, ModelProvider } from "./model.ts";
import type { Executor, ExecuteResult } from "../core/executor.ts";
import type { Store } from "../core/store.ts";
import type { PaymentIntent } from "../core/types.ts";

export interface AgentDeps {
  model: ModelProvider;
  executor: Executor;
  store: Store;
  clock: () => string;
  newId: () => string;
}

export interface AgentTurnResult {
  decision: ModelDecision;
  execution: ExecuteResult | null;
}

function buildContext(store: Store, now: string): AgentContext {
  return {
    mandates: store.listActiveMandates(now).map((m) => ({
      id: m.id,
      label: m.label,
      scope: m.scope,
      currency: m.currency,
      allowedRails: m.allowedRails,
      perTxCap: m.perTxCap,
      perPeriodCap: m.perPeriodCap,
      period: m.period,
    })),
  };
}

export async function runAgentTurn(
  goal: string,
  deps: AgentDeps,
): Promise<AgentTurnResult> {
  const ctx = buildContext(deps.store, deps.clock());
  const decision = await deps.model.propose(goal, ctx);
  if (decision.kind !== "pay") return { decision, execution: null };

  // Boundary validation: a malformed/injected draft is rejected here, before
  // it can become a PaymentIntent.
  const draft = PaymentIntentDraftSchema.parse(decision.draft);
  const intent: PaymentIntent = {
    ...draft,
    id: deps.newId(),
    createdAt: deps.clock(),
  };
  const execution = await deps.executor.execute(intent);
  return { decision, execution };
}
