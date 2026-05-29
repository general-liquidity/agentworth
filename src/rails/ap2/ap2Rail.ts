// AP2 PaymentProvider. "Settle" = build the Payment Mandate content, hand it to
// the injected Ap2Client to assemble+bind the checkout, sign the SD-JWT (ES256),
// present it to the Credential Provider, and return the Payment Receipt. The
// adapter shapes our Receipt from that. AP2 is rail-agnostic, so the profile is
// configurable: default = card-backed (checkout / reversible); pass the x402/
// crypto profile (onchain / irreversible) when settling over stablecoins.
//
// With no client the rail fails safe (no fabricated settlement) — same contract
// as every other adapter.

import { createNetworkRail, type RailClient } from "../networkRail.ts";
import type { PaymentProvider } from "../provider.ts";
import type { PaymentIntent, RailKind, Reversibility } from "../../core/types.ts";
import {
  buildPaymentMandateContent,
  type Ap2PaymentInstrument,
  type Ap2PaymentMandateContent,
  type Ap2PaymentReceipt,
} from "./mandate.ts";

/** The live integration: assembles the checkout, binds + signs the SD-JWT
 * mandate(s), presents to the Credential Provider, returns the Payment Receipt.
 * Operator-supplied (the SD-JWT/ECDSA crypto + network live here). */
export interface Ap2Client {
  present(
    intent: PaymentIntent,
    mandate: Ap2PaymentMandateContent,
  ): Promise<Ap2PaymentReceipt> | Ap2PaymentReceipt;
}

export interface Ap2RailOptions {
  client?: Ap2Client;
  instrument?: Ap2PaymentInstrument;
  /** Settlement profile. Card-backed default; set onchain/irreversible for x402. */
  rail?: RailKind;
  reversibility?: Reversibility;
}

const DEFAULT_INSTRUMENT: Ap2PaymentInstrument = { id: "default", type: "card" };

export function createAp2Rail(options: Ap2RailOptions = {}): PaymentProvider {
  const reversibility = options.reversibility ?? "reversible";
  const instrument = options.instrument ?? DEFAULT_INSTRUMENT;

  const railClient: RailClient | undefined = options.client
    ? {
        async settle(intent) {
          const content = buildPaymentMandateContent(intent, { instrument });
          const receipt = await options.client!.present(intent, content);
          if (receipt.status !== "Success") {
            throw new Error(`ap2: ${receipt.error ?? "payment declined"}`);
          }
          return {
            providerRef: receipt.payment_id,
            finality: reversibility === "irreversible" ? "final" : "reversible",
          };
        },
        verifyReceipt: (r) => r.providerRef.length > 0,
      }
    : undefined;

  return createNetworkRail({
    id: "ap2",
    rail: options.rail ?? "checkout",
    reversibility,
    settlementFinality: "delayed",
    defaultFinality: reversibility === "irreversible" ? "final" : "reversible",
    client: railClient,
  });
}
