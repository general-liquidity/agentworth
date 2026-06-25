// UCP — Universal Commerce Protocol (https://ucp.dev; co-developed by Google,
// Shopify, Amazon, Walmart, Target, Stripe, Marriott, Booking.com, DoorDash,
// Uber Eats, …). UCP is the agent↔merchant CHECKOUT handshake (OAuth2 identity,
// line items, fulfilment) — it does NOT settle payment itself. It is fully
// COMPATIBLE with AP2 (Agent Payments Protocol) as an optional trust layer: UCP
// owns the checkout, AP2 supplies the cryptographically-signed payment mandates.
// The AP2 Checkout Mandate does NOT *contain* the UCP Checkout object — it carries
// the HASH of the UCP CheckoutObject and a detached checkout signature OVER it
// (per ucp.dev/documentation/ucp-and-ap2), i.e. the mandate signs the checkout,
// it is not the checkout. So the live RailClient here typically wraps an
// AP2-backed settlement (see rails/ap2).
//
// REVERSIBILITY: UCP is rail-agnostic at settlement — the underlying instrument
// can be a card (reversible) OR a stablecoin (irreversible), like MPP. The gate
// reads reversibility to set scrutiny, so we declare the CONSERVATIVE default
// `irreversible` here; route a card-backed UCP checkout to a reversible rail when
// the instrument is known to be reversible.

import { createNetworkRail, type RailClient } from "./networkRail.ts";
import type { PaymentProvider } from "./provider.ts";

export type UcpClient = RailClient;

export function createUcpRail(client?: UcpClient): PaymentProvider {
  return createNetworkRail({
    id: "ucp",
    rail: "checkout",
    reversibility: "irreversible", // conservative default — UCP is rail-agnostic
    settlementFinality: "delayed",
    defaultFinality: "pending",
    client,
  });
}
