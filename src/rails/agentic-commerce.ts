// Agentic Commerce Protocol (https://www.agenticcommerce.dev, OpenAI + Stripe).
// NOTE: "ACP" here is the *Agentic Commerce* Protocol — NOT the Agent Client
// Protocol (Zed) in `src/acp/`. They share the acronym but are unrelated; this
// file is deliberately named `agentic-commerce` to break that collision.
//
// An agent completes a merchant checkout via a delegated payment token;
// settlement runs over card rails, so it is reversible (chargeback/refund) and
// typically clears with a short delay. The live integration (a Stripe-backed
// checkout/token client) is supplied as the RailClient.

import { createNetworkRail, type RailClient } from "./networkRail.ts";
import type { PaymentProvider } from "./provider.ts";

export type AgenticCommerceClient = RailClient;

export function createAgenticCommerceRail(client?: AgenticCommerceClient): PaymentProvider {
  return createNetworkRail({
    id: "agentic-commerce",
    rail: "checkout",
    reversibility: "reversible",
    settlementFinality: "delayed",
    defaultFinality: "reversible",
    client,
  });
}
