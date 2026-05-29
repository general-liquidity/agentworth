// Mastercard Agent Pay
// (https://www.mastercard.com/global/en/business/artificial-intelligence/mastercard-agent-pay.html).
// Agentic Tokens bind a payment credential to a specific agent + merchant +
// consent and are revocable. Card settlement ⇒ reversible, clears with a delay.
// The live Mastercard client is supplied as the RailClient.
//
// NOTE: capability metadata here follows the standard card-network model
// (reversible/delayed) — the official page (mastercard.com) returned 403 and
// could not be re-verified; confirm against Mastercard developer docs when wiring
// the live client.

import { createNetworkRail, type RailClient } from "./networkRail.ts";
import type { PaymentProvider } from "./provider.ts";

export type MastercardAgentPayClient = RailClient;

export function createMastercardAgentPayRail(
  client?: MastercardAgentPayClient,
): PaymentProvider {
  return createNetworkRail({
    id: "mastercard-agent-pay",
    rail: "card",
    reversibility: "reversible",
    settlementFinality: "delayed",
    defaultFinality: "reversible",
    client,
  });
}
