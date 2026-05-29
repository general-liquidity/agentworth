// x402 (https://x402.org, https://x402.eco) — HTTP-402 + stablecoin settlement
// (Coinbase / Linux Foundation). Flow: a resource returns HTTP 402 with payment
// requirements → the client signs a payment authorization (e.g. EIP-3009 on Base
// USDC) → resends with an `X-PAYMENT` header → a facilitator verifies on-chain
// and the receipt is the settlement reference. On-chain ⇒ irreversible, instant.
// The client (wallet/signer + facilitator URL) is the live integration.

import { createNetworkRail, type RailClient } from "./networkRail.ts";
import type { PaymentProvider } from "./provider.ts";

export type X402Client = RailClient;

export function createX402Rail(client?: X402Client): PaymentProvider {
  return createNetworkRail({
    id: "x402",
    rail: "onchain",
    reversibility: "irreversible",
    settlementFinality: "instant",
    defaultFinality: "final",
    client,
  });
}
