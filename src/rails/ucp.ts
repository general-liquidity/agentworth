// UCP — Universal Commerce Protocol (https://ucp.dev; co-developed by Google,
// Shopify, Amazon, Walmart, Target, Stripe, Marriott, Booking.com, DoorDash,
// Uber Eats, …). UCP is the agent↔merchant CHECKOUT handshake (OAuth2 identity,
// line items, fulfilment) — it does NOT settle payment itself. It is fully
// COMPATIBLE with AP2 (Agent Payments Protocol) as an optional trust layer: UCP
// owns the checkout, AP2 supplies the cryptographically-signed payment mandates
// (its Checkout Mandate's checkout_jwt is the UCP Checkout object). So the live
// RailClient here typically wraps an AP2-backed settlement (see rails/ap2);
// reversibility/rail depend on the underlying instrument (commonly cards ⇒ reversible).

import { createNetworkRail, type RailClient } from "./networkRail.ts";
import type { PaymentProvider } from "./provider.ts";

export type UcpClient = RailClient;

export function createUcpRail(client?: UcpClient): PaymentProvider {
  return createNetworkRail({
    id: "ucp",
    rail: "checkout",
    reversibility: "reversible",
    settlementFinality: "delayed",
    defaultFinality: "reversible",
    client,
  });
}
