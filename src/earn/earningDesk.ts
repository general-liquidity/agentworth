// The EARNING side — the new axis the agentic-economy article points at: agents
// don't just spend, they EARN. This is the inbound mirror of the gate. The agent
// publishes a machine-readable price (a quote), and when a payment arrives it is
// run through an ACCEPTANCE POLICY (the inbound analogue of the spend gate) +
// a proof verifier before being recorded as earned. Everything lands in the SAME
// signed audit log (single substrate) as `earning.quoted` / `earning.received` /
// `earning.rejected` — so inbound is as accountable as outbound.
//
// The proof verifier (does the on-chain/x402 payment actually exist?) is injected
// — same honest boundary as the rail clients. With no verifier, inbound is
// rejected as unverifiable (never recorded as earned on faith).

import type { AuditLog } from "../core/audit.ts";
import type { Store } from "../core/store.ts";

export interface PriceQuote {
  service: string;
  priceMinor: number;
  currency: string;
  payTo?: string;
  description?: string;
  expiresAt?: string;
}

export interface InboundPayment {
  service: string;
  amountMinor: number;
  currency: string;
  payer?: string;
  /** Proof of payment (e.g. an x402 settlement reference / tx hash). */
  proof?: unknown;
}

/** The inbound analogue of the spend gate: what payments the agent will accept. */
export interface AcceptancePolicy {
  currency: string;
  minPriceMinor: number;
  allowedServices?: string[]; // if set, only these services may be charged for
}

/** Confirms an inbound payment proof really settled (injected; live x402/chain check). */
export interface EarningVerifier {
  verify(payment: InboundPayment): Promise<boolean> | boolean;
}

export interface ReceiveResult {
  accepted: boolean;
  reasons: string[];
}

export interface EarningDeskDeps {
  audit: AuditLog;
  store: Store;
  clock: () => string;
  policy: AcceptancePolicy;
  verifier?: EarningVerifier;
}

export function evaluateInbound(
  payment: InboundPayment,
  policy: AcceptancePolicy,
): ReceiveResult {
  const reasons: string[] = [];
  if (payment.currency !== policy.currency) {
    reasons.push(`currency ${payment.currency} not accepted (want ${policy.currency})`);
  }
  if (payment.amountMinor < policy.minPriceMinor) {
    reasons.push(`amount ${payment.amountMinor} below minimum ${policy.minPriceMinor}`);
  }
  if (policy.allowedServices && !policy.allowedServices.includes(payment.service)) {
    reasons.push(`service "${payment.service}" is not offered`);
  }
  return { accepted: reasons.length === 0, reasons };
}

export function createEarningDesk(deps: EarningDeskDeps) {
  function record(
    type: "earning.quoted" | "earning.received" | "earning.rejected",
    payload: unknown,
  ): void {
    deps.store.appendAudit(deps.audit.append(type, payload, deps.clock()));
  }

  function quote(service: string, priceMinor: number, payTo?: string): PriceQuote {
    const q: PriceQuote = { service, priceMinor, currency: deps.policy.currency, payTo };
    record("earning.quoted", q);
    return q;
  }

  async function receive(payment: InboundPayment): Promise<ReceiveResult> {
    const policyCheck = evaluateInbound(payment, deps.policy);
    if (!policyCheck.accepted) {
      record("earning.rejected", { payment, reasons: policyCheck.reasons });
      return policyCheck;
    }
    // Never record income on faith — the proof must verify.
    if (!deps.verifier) {
      const reasons = ["no earning verifier configured — cannot confirm payment"];
      record("earning.rejected", { payment, reasons });
      return { accepted: false, reasons };
    }
    const verified = await deps.verifier.verify(payment);
    if (!verified) {
      const reasons = ["payment proof did not verify"];
      record("earning.rejected", { payment, reasons });
      return { accepted: false, reasons };
    }
    record("earning.received", {
      service: payment.service,
      amount: payment.amountMinor,
      currency: payment.currency,
      payer: payment.payer,
    });
    return { accepted: true, reasons: ["payment verified and recorded"] };
  }

  return { quote, receive };
}
