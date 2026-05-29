// Shared builder for real network rails. Each protocol adapter (x402, ACP, UCP,
// MPP, Visa, Mastercard) is a thin wrapper that supplies its capabilities and,
// at runtime, a `RailClient` that performs the live settlement.
//
// THE FAIL-SAFE CONTRACT: with no client, `settle` THROWS — a real rail never
// fabricates a settlement. The executor catches that and records `payment.failed`
// (no receipt), so an unconfigured rail can never look like a successful payment.
// The actual network/credential integration lives entirely in the operator's
// `RailClient` implementation; this layer only shapes and verifies receipts.

import type {
  PaymentIntent,
  RailKind,
  Receipt,
  Reversibility,
  SettlementFinality,
} from "../core/types.ts";
import type { PaymentProvider } from "./provider.ts";

export interface RailSettlement {
  /** The rail's own reference: tx hash, charge id, checkout-session id, … */
  providerRef: string;
  finality?: SettlementFinality;
}

/** The live-integration seam. Implemented by the operator with real credentials
 * (a wallet/signer + facilitator for x402, a Stripe key for ACP, a Visa client,
 * …). Kept out of this repo because it requires per-network onboarding. */
export interface RailClient {
  settle(intent: PaymentIntent): Promise<RailSettlement> | RailSettlement;
  verifyReceipt?(receipt: Receipt): boolean;
}

export interface NetworkRailSpec {
  id: string;
  rail: RailKind;
  reversibility: Reversibility;
  settlementFinality: "instant" | "delayed";
  defaultFinality: SettlementFinality;
  client?: RailClient;
}

export function createNetworkRail(spec: NetworkRailSpec): PaymentProvider {
  return {
    capabilities: {
      id: spec.id,
      rail: spec.rail,
      reversibility: spec.reversibility,
      settlementFinality: spec.settlementFinality,
    },
    async settle(intent: PaymentIntent, now: string): Promise<Receipt> {
      if (!spec.client) {
        throw new Error(
          `${spec.id} rail not configured: provide a RailClient with live ` +
            `credentials. Refusing to fabricate a settlement.`,
        );
      }
      const settlement = await spec.client.settle(intent);
      return {
        id: `rcpt_${spec.id}_${intent.id}`,
        intentId: intent.id,
        rail: spec.rail,
        amount: intent.amount,
        currency: intent.currency,
        settledAt: now,
        providerRef: settlement.providerRef,
        finality: settlement.finality ?? spec.defaultFinality,
      };
    },
    verifyReceipt(receipt: Receipt): boolean {
      if (spec.client?.verifyReceipt) return spec.client.verifyReceipt(receipt);
      return (
        receipt.id === `rcpt_${spec.id}_${receipt.intentId}` &&
        receipt.providerRef.length > 0
      );
    },
  };
}
