// A REAL settlement client modelling the x402 protocol flow (HTTP 402 Payment
// Required → pay the quoted requirements → retry with an X-PAYMENT proof). This is
// the protocol shape PayGraph's X402Gateway implements; here it's expressed as a
// RailClient so it plugs into `createX402Rail(client)` like any other.
//
// The flow, per the x402 spec:
//   1. The resource server answers an unpaid request with 402 + `accepts` (a list
//      of PaymentRequirements: scheme, network, asset, payTo, maxAmountRequired).
//   2. The client selects a requirement it can satisfy, has its wallet/facilitator
//      produce a signed payment payload, and retries with the `X-PAYMENT` header.
//   3. The server (via a facilitator) verifies + settles on-chain and returns the
//      resource plus `X-PAYMENT-RESPONSE` carrying the settlement tx reference.
//
// The on-chain signing + facilitator verify/settle live behind the injected
// `X402Facilitator` (the only thing that touches a key or an RPC), so the
// selection/quote/retry logic is correct and unit-testable here. Multi-network
// (EVM + Solana USDC) is just which requirement the selector accepts.
//
// amount is integer minor-units == the asset's smallest unit (USDC: 6 decimals).

import type { PaymentIntent } from "../../core/types.ts";
import type { RailClient, RailSettlement } from "../networkRail.ts";

export interface PaymentRequirements {
  scheme: string; // e.g. "exact"
  network: string; // e.g. "base", "base-sepolia", "solana"
  asset: string; // token contract / mint address
  payTo: string;
  maxAmountRequired: string; // minor-units, as a decimal string (spec uses strings)
  resource?: string;
}

export interface SettledPayment {
  /** The on-chain settlement reference (tx hash / signature). */
  txRef: string;
  network: string;
}

/** The live seam: a wallet + facilitator. A real x402 SDK client satisfies it; a
 * mock satisfies it in tests. */
export interface X402Facilitator {
  /** Produce a signed X-PAYMENT payload for the chosen requirement + amount. */
  authorize(args: {
    requirement: PaymentRequirements;
    amountMinor: number;
    reference: string;
  }): Promise<string> | string;
  /** Verify + settle the payment; returns the on-chain reference. */
  settle(args: {
    requirement: PaymentRequirements;
    paymentHeader: string;
  }): Promise<SettledPayment> | SettledPayment;
}

export interface X402RailConfig {
  facilitator: X402Facilitator;
  /** Fetch the resource's 402 challenge for this intent. Returns the `accepts`
   * list the server would send. Operator wires this to the real HTTP round-trip. */
  quote: (intent: PaymentIntent) => Promise<PaymentRequirements[]> | PaymentRequirements[];
  /** Which networks this operator's wallet can pay on. Defaults to all offered. */
  networks?: string[];
}

/** Pick the first offered requirement on an acceptable network whose price the
 * intent covers. Returns undefined if none qualifies. */
function selectRequirement(
  accepts: PaymentRequirements[],
  amountMinor: number,
  networks?: string[],
): PaymentRequirements | undefined {
  return accepts.find((r) => {
    if (networks && !networks.includes(r.network)) return false;
    const max = Number(r.maxAmountRequired);
    return Number.isFinite(max) && amountMinor <= max;
  });
}

export function createX402RailClient(config: X402RailConfig): RailClient {
  return {
    async settle(intent: PaymentIntent): Promise<RailSettlement> {
      const accepts = await config.quote(intent);
      const requirement = selectRequirement(accepts, intent.amount, config.networks);
      if (!requirement) {
        throw new Error(
          `x402 rail: no acceptable payment requirement for intent ${intent.id} ` +
            `(amount ${intent.amount}, networks ${config.networks?.join(",") ?? "any"})`,
        );
      }
      const paymentHeader = await config.facilitator.authorize({
        requirement,
        amountMinor: intent.amount,
        reference: intent.id,
      });
      const settled = await config.facilitator.settle({ requirement, paymentHeader });
      return { providerRef: settled.txRef, finality: "final" }; // on-chain ⇒ irreversible
    },
    verifyReceipt: (receipt) => receipt.providerRef.length > 0,
  };
}
