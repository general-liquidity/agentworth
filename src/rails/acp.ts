// ACP — Agentic Commerce Protocol (https://www.agenticcommerce.dev, OpenAI +
// Stripe). An agent completes a merchant checkout via a delegated payment token;
// settlement runs over card rails, so it is reversible (chargeback/refund) and
// typically clears with a short delay. The live integration (a Stripe-backed
// checkout/token client) is supplied as the RailClient.

import { createNetworkRail, type RailClient } from "./networkRail.ts";
import type { PaymentProvider } from "./provider.ts";

export type AcpClient = RailClient;

export function createAcpRail(client?: AcpClient): PaymentProvider {
  return createNetworkRail({
    id: "acp",
    rail: "checkout",
    reversibility: "reversible",
    settlementFinality: "delayed",
    defaultFinality: "reversible",
    client,
  });
}
