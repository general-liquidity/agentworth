// MPP — Machine Payments Protocol (https://mpp.dev; Tempo + Stripe). An open,
// HTTP-402, machine-to-machine standard with a challenge → credential → receipt
// flow (402 `WWW-Authenticate` → `Authorization` credential → `Payment-Receipt`)
// that is RAIL-AGNOSTIC: it brokers over Tempo stablecoins, Stripe cards,
// Lightning, Solana, Stellar, Monad, or custom rails. Near-zero latency ⇒ instant.
//
// SAFETY NOTE: because the underlying rail is chosen at settlement, MPP can be
// irreversible (stablecoin) OR reversible (card). The gate scores risk from the
// `intent.rail` KIND, so route an MPP payment to `onchain` when it will settle
// on-chain (so the gate treats it as irreversible/higher-risk). We declare
// `irreversible` here as the conservative default for a variable-rail protocol.

import { createNetworkRail, type RailClient } from "./networkRail.ts";
import type { PaymentProvider } from "./provider.ts";

export type MppClient = RailClient;

export function createMppRail(client?: MppClient): PaymentProvider {
  return createNetworkRail({
    id: "mpp",
    rail: "checkout",
    reversibility: "irreversible", // conservative default — MPP is rail-agnostic
    settlementFinality: "instant",
    defaultFinality: "pending",
    client,
  });
}
