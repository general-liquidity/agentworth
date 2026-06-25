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

/** An x402 `accepts[]` entry, field-exact with the V1 PaymentRequirements schema
 * (https://github.com/coinbase/x402, scheme "exact"). The facilitator needs the
 * full requirement — not just price/payTo — to build the EIP-3009 authorization:
 * `maxTimeoutSeconds` bounds the signed `validBefore`, and `extra` carries the
 * asset's EIP-712 domain (`name`/`version`) the signer must hash over. */
export interface PaymentRequirements {
  scheme: string; // e.g. "exact"
  network: string; // e.g. "base", "base-sepolia", "solana"
  asset: string; // token contract / mint address
  payTo: string;
  maxAmountRequired: string; // minor-units, as a decimal string (spec uses strings)
  resource?: string; // the protected resource URL
  description?: string;
  mimeType?: string;
  maxTimeoutSeconds?: number; // bounds the signed authorization's validity window
  extra?: { name?: string; version?: string }; // asset EIP-712 domain (name/version)
}

/** The EIP-3009 `transferWithAuthorization` message the client signs. */
export interface X402Authorization {
  from: string;
  to: string;
  value: string; // minor-units, decimal string
  validAfter: string; // unix seconds, decimal string
  validBefore: string; // unix seconds, decimal string
  nonce: string; // 32-byte hex
}

/** The decoded `X-PAYMENT` header payload (base64-encoded on the wire). */
export interface X402PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: { signature: string; authorization: X402Authorization };
}

/** The decoded `X-PAYMENT-RESPONSE` header — the facilitator's settlement result
 * (https://github.com/coinbase/x402 SettleResponse). */
export interface X402SettleResponse {
  success: boolean;
  transaction: string; // on-chain tx hash / signature
  network: string;
  payer?: string;
}

export interface SettledPayment {
  /** The on-chain settlement reference (tx hash / signature). */
  txRef: string;
  network: string;
  /** From the X-PAYMENT-RESPONSE, when the facilitator surfaces it. */
  success?: boolean;
  payer?: string;
}

/** The x402 protocol version this adapter targets. V1 wire shape (network names
 * like "base"/"base-sepolia", `x402Version: 1`). V2 (CAIP-2 network ids,
 * `x402Version: 2`) is a separate migration. */
export const X402_VERSION = 1;

/** Encode a structured payload into the `X-PAYMENT` header value (base64 JSON —
 * the x402 wire encoding). A real facilitator's `authorize` returns this. */
export function encodePaymentHeader(payload: X402PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

/** Decode an `X-PAYMENT` header value back to its structured payload. */
export function decodePaymentHeader(header: string): X402PaymentPayload {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as X402PaymentPayload;
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
      if (settled.success === false) {
        throw new Error(`x402 rail: facilitator reported settlement failure for ${intent.id}`);
      }
      return { providerRef: settled.txRef, finality: "final" }; // on-chain ⇒ irreversible
    },
    verifyReceipt: (receipt) => receipt.providerRef.length > 0,
  };
}
