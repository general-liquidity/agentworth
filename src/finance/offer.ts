// Service discovery + price evaluation — the "find → evaluate → pay" loop for the
// agentic economy (Base/x402 sellers publish machine-readable prices). A
// ServiceOffer is a machine-readable price for a service; `evaluateOffer` checks
// it against the operator's live mandates BEFORE the agent commits — so the agent
// doesn't propose a payment it can't afford or isn't authorized for. This is an
// ADVISORY pre-check; the gate remains the authority (the agent still turns a
// chosen offer into a PaymentIntent that runs through the gate).

import { covers, isLiveMandate } from "../core/gate.ts";
import type { Mandate, PaymentIntent, RailKind } from "../core/types.ts";

export interface ServiceOffer {
  service: string;
  payee: string;
  payeeClass: string;
  priceMinor: number;
  currency: string;
  rail: RailKind;
  description?: string;
}

export interface OfferEvaluation {
  affordable: boolean;
  coveringMandateId: string | null;
  reasons: string[];
}

export interface ServiceCatalog {
  list(): ServiceOffer[];
  find(query: string): ServiceOffer[];
}

export function staticCatalog(offers: ServiceOffer[]): ServiceCatalog {
  return {
    list: () => [...offers],
    find: (query) => {
      const q = query.toLowerCase();
      return offers.filter(
        (o) =>
          o.service.toLowerCase().includes(q) ||
          o.payeeClass.toLowerCase().includes(q) ||
          (o.description ?? "").toLowerCase().includes(q),
      );
    },
  };
}

function offerAsIntent(offer: ServiceOffer): PaymentIntent {
  return {
    id: "offer-probe",
    payee: offer.payee,
    payeeClass: offer.payeeClass,
    amount: offer.priceMinor,
    currency: offer.currency,
    rail: offer.rail,
    rationale: `evaluate offer: ${offer.service}`,
    createdAt: "",
  };
}

/** Is this offer payable under a live mandate, within its per-tx cap? Advisory. */
export function evaluateOffer(
  offer: ServiceOffer,
  mandates: Mandate[],
  now: string,
): OfferEvaluation {
  const probe = offerAsIntent(offer);
  const mandate = mandates.find((m) => isLiveMandate(m, now) && covers(m, probe));
  if (!mandate) {
    return {
      affordable: false,
      coveringMandateId: null,
      reasons: ["no live mandate covers this service (class/rail/currency)"],
    };
  }
  if (offer.priceMinor > mandate.perTxCap) {
    return {
      affordable: false,
      coveringMandateId: mandate.id,
      reasons: [`price ${offer.priceMinor} exceeds per-transaction cap ${mandate.perTxCap}`],
    };
  }
  return {
    affordable: true,
    coveringMandateId: mandate.id,
    reasons: [`payable under mandate ${mandate.id}`],
  };
}

/** Turn a chosen offer into a PaymentIntent (which still goes through the gate). */
export function offerToIntent(
  offer: ServiceOffer,
  id: string,
  createdAt: string,
  rationale?: string,
): PaymentIntent {
  return {
    id,
    payee: offer.payee,
    payeeClass: offer.payeeClass,
    amount: offer.priceMinor,
    currency: offer.currency,
    rail: offer.rail,
    rationale: rationale ?? `pay for ${offer.service}`,
    createdAt,
  };
}
