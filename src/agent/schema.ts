// The schema the model must satisfy to spend. The agent's only spend tool is
// `pay`; its arguments are validated against PaymentIntentDraftSchema at the
// boundary before anything reaches the executor — a malformed or injected
// payload is rejected here, structurally, not by trusting the model.

import { z } from "zod";

export const RAIL_KINDS = ["onchain", "card", "checkout"] as const;

export const PaymentIntentDraftSchema = z.object({
  payee: z.string().min(1),
  payeeClass: z.string().min(1),
  amount: z.number().int().positive(),
  currency: z.string().min(1),
  rail: z.enum(RAIL_KINDS),
  rationale: z.string().min(1),
});

export type PaymentIntentDraft = z.infer<typeof PaymentIntentDraftSchema>;

/** Tool definition handed to a real model (OpenAI/Anthropic tool-calling). */
export const PAY_TOOL = {
  name: "pay",
  description:
    "Propose a payment. It will be evaluated by the governance gate against the " +
    "operator's mandates, caps, and risk thresholds — you cannot bypass that. " +
    "Amounts are integer minor-units (e.g. 800 = £8.00).",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["payee", "payeeClass", "amount", "currency", "rail", "rationale"],
    properties: {
      payee: { type: "string", description: "Stable payee identifier" },
      payeeClass: { type: "string", description: "Payee class, e.g. groceries" },
      amount: { type: "integer", minimum: 1, description: "Minor-units, > 0" },
      currency: { type: "string", description: "ISO-4217 or token symbol" },
      rail: { type: "string", enum: [...RAIL_KINDS] },
      rationale: { type: "string", description: "Why this payment" },
    },
  },
} as const;
