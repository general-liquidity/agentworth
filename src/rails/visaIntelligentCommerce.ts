// Visa Intelligent Commerce
// (https://corporate.visa.com/en/products/intelligent-commerce.html). Lets an
// agent transact on Visa card rails via a tokenised credential bound to the
// consumer's consent. Card settlement ⇒ reversible, clears with a delay. Pairs
// with Visa's Trusted Agent Protocol for agent identity (that is an identity
// layer feeding the mandate/risk side, NOT a settlement rail). The live Visa
// client is supplied as the RailClient.

import { createNetworkRail, type RailClient } from "./networkRail.ts";
import type { PaymentProvider } from "./provider.ts";

export type VisaIntelligentCommerceClient = RailClient;

export function createVisaIntelligentCommerceRail(
  client?: VisaIntelligentCommerceClient,
): PaymentProvider {
  return createNetworkRail({
    id: "visa-intelligent-commerce",
    rail: "card",
    reversibility: "reversible",
    settlementFinality: "delayed",
    defaultFinality: "reversible",
    client,
  });
}
