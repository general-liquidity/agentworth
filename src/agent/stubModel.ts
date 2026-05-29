// Deterministic model for tests and offline use. Parses a tiny DSL into a
// payment draft so the full agent → gate → executor path is exercised without
// a live LLM:
//
//   PAY <amount> <currency> <payee> <payeeClass> <rail> :: <rationale>
//
// Anything else comes back as a plain message.

import type { ModelDecision, ModelProvider } from "./model.ts";
import type { PaymentIntentDraft } from "./schema.ts";

const PAY_RE =
  /^PAY\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*::\s*(.+)$/s;

export function createStubModel(): ModelProvider {
  return {
    propose(goal): Promise<ModelDecision> {
      const m = goal.trim().match(PAY_RE);
      if (!m) {
        return Promise.resolve({
          kind: "message",
          message: `No payment proposed for: ${goal}`,
        });
      }
      return Promise.resolve({
        kind: "pay",
        draft: {
          amount: Number(m[1]),
          currency: m[2],
          payee: m[3],
          payeeClass: m[4],
          // validated downstream by PaymentIntentDraftSchema; an invalid rail
          // string is rejected there, not trusted here.
          rail: m[5] as PaymentIntentDraft["rail"],
          rationale: m[6].trim(),
        },
      });
    },
  };
}
