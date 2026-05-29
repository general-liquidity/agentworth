// A deterministic in-process rail. It "settles" by minting a receipt — no
// network, no money — so the whole executor → gate → settle path is testable
// end-to-end before any real rail is wired. `failOn` lets tests exercise the
// settlement-failure branch.

import { RAIL_REVERSIBILITY, type PaymentIntent, type RailKind, type Receipt } from "../core/types.ts";
import type { PaymentProvider } from "./provider.ts";

export interface FakeRailOptions {
  failOn?: (intent: PaymentIntent) => boolean;
}

export function createFakeRail(
  rail: RailKind,
  options: FakeRailOptions = {},
): PaymentProvider {
  const reversibility = RAIL_REVERSIBILITY[rail];
  const prefix = `fake:${rail}:`;
  return {
    capabilities: { id: `fake-${rail}`, rail, reversibility, settlementFinality: "instant" },
    settle(intent, now): Receipt {
      if (options.failOn?.(intent)) {
        throw new Error(`fake-rail(${rail}): settlement declined`);
      }
      return {
        id: `rcpt_${intent.id}`,
        intentId: intent.id,
        rail,
        amount: intent.amount,
        currency: intent.currency,
        settledAt: now,
        providerRef: `${prefix}${intent.id}`,
        finality: reversibility === "irreversible" ? "final" : "reversible",
      };
    },
    verifyReceipt(receipt): boolean {
      return receipt.providerRef.startsWith(prefix) && receipt.id === `rcpt_${receipt.intentId}`;
    },
    refund(receipt, amountMinor): { refundRef: string } {
      return { refundRef: `${prefix}refund:${receipt.intentId}:${amountMinor}` };
    },
  };
}
