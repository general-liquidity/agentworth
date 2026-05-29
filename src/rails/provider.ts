// The rail abstraction. Re-domained from Gordon's exchange/broker adapters:
// rails are deliberately "dumb" — the value is the gate above them. A rail
// settles a payment the gate has already authorized and returns a Receipt.
//
// Five verbs from the agentic-payments design (x402/MPP/ACP shapes): only
// `settle` and `verifyReceipt` are required for v1; quote/challenge/present are
// optional and rail-specific (e.g. x402's 402-challenge handshake).

import type { PaymentIntent, RailKind, Receipt, Reversibility } from "../core/types.ts";

export interface ProviderCapabilities {
  /** Stable protocol id, e.g. "x402", "acp", "visa-intelligent-commerce". Many
   * providers can share a `rail` kind (Visa and Mastercard are both `card`), so
   * the registry keys on `id` and routes a rail kind to the chosen provider. */
  id: string;
  rail: RailKind;
  reversibility: Reversibility;
  settlementFinality: "instant" | "delayed";
}

export interface PaymentProvider {
  capabilities: ProviderCapabilities;
  /** Move the money. Called ONLY by the executor, ONLY after a gate decision.
   * May be async (real network rails) or sync (the in-process fake rail). A real
   * rail that is not configured MUST throw rather than fabricate a settlement. */
  settle(intent: PaymentIntent, now: string): Promise<Receipt> | Receipt;
  /** Confirm a receipt was issued by this provider (audit/dispute support). */
  verifyReceipt(receipt: Receipt): boolean;
  /** Reverse a settled payment (refund/chargeback). Only meaningful on reversible
   * rails; the executor refuses to refund an irreversible settlement. */
  refund?(receipt: Receipt, amountMinor: number, now: string): Promise<{ refundRef: string }> | { refundRef: string };

  // Optional rail-specific handshake verbs (e.g. x402's 402-challenge):
  quote?(intent: PaymentIntent): unknown;
  challenge?(intent: PaymentIntent): unknown;
  present?(intent: PaymentIntent, challenge: unknown): unknown;
}
