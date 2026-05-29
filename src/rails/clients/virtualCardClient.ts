// A REAL settlement client for the `card` rail using the single-use virtual-card
// pattern (Stripe Issuing / Lithic / Marqeta): mint a FRESH card per intent, with
// a spend limit pinned to exactly the intent amount, optionally locked to the
// payee's merchant. The card number never outlives the one charge — a compromised
// number is worthless and the per-card limit is a hard ceiling the network itself
// enforces, independent of our gate.
//
// This is the card analogue of `createOnchainRailClient`: settlement logic is
// correct and unit-testable here against a mock `CardIssuer`; the live Issuing API
// key is supplied by the operator (the only thing that can mint a real card).
// Plugs into any `card`-kind network rail (createVisaIntelligentCommerceRail /
// createMastercardAgentPayRail) as their injected RailClient.
//
// Reversibility: card rails are reversible (chargebacks/voids), so a minted card
// can be cancelled; `refundCard` voids the authorization where the issuer supports
// it. amount is integer minor-units in the card's currency.

import type { PaymentIntent, Receipt } from "../../core/types.ts";
import type { RailClient, RailSettlement } from "../networkRail.ts";

export interface IssuedCard {
  /** The issuer's card id (e.g. Stripe `ic_…`). Becomes the receipt providerRef. */
  cardId: string;
  /** The single authorization spend limit, in minor-units. */
  spendLimitMinor: number;
}

/** The subset of an Issuing API we use. A real Stripe/Lithic client satisfies it
 * via a thin adapter; a mock satisfies it in tests. */
export interface CardIssuer {
  /** Mint a single-use card capped at exactly `spendLimitMinor`, optionally locked
   * to `merchant`. Returns the issuer card id. */
  createCard(args: {
    spendLimitMinor: number;
    currency: string;
    merchant?: string;
    reference: string;
  }): Promise<IssuedCard> | IssuedCard;
  /** Void/cancel a previously minted card (for refund / cleanup). */
  cancelCard?(cardId: string): Promise<void> | void;
}

export interface VirtualCardRailConfig {
  issuer: CardIssuer;
  /** Map an operator-facing payee id to a network merchant lock, if known. */
  resolveMerchant?: (payee: string) => string | undefined;
}

export function createVirtualCardRailClient(config: VirtualCardRailConfig): RailClient {
  return {
    async settle(intent: PaymentIntent): Promise<RailSettlement> {
      const card = await config.issuer.createCard({
        spendLimitMinor: intent.amount, // hard per-card ceiling == the intent amount
        currency: intent.currency,
        merchant: config.resolveMerchant?.(intent.payee),
        reference: intent.id,
      });
      return { providerRef: card.cardId, finality: "reversible" }; // card ⇒ chargeback-able
    },
    verifyReceipt: (receipt: Receipt) => receipt.providerRef.length > 0,
  };
}
