// The persistence boundary. The executor depends on this interface, never on a
// concrete database, so the gate logic is storage-agnostic and the same code
// runs against an in-memory store (tests) or node:sqlite (production).

import type { AuditEntry } from "./audit.ts";
import type {
  Mandate,
  PaymentIntent,
  Period,
  PriorSpend,
  Receipt,
} from "./types.ts";

export type IntentStatus = "pending" | "settled" | "blocked" | "failed";

/** A payment intent as persisted, with the gate decision that classified it. */
export interface StoredIntent {
  intent: PaymentIntent;
  status: IntentStatus;
  mandateId: string | null;
  reasons: string[];
  settledAt: string | null;
  receiptId: string | null;
  /** Amount refunded against a settled payment (nets out of period spend). */
  refundedMinor?: number;
}

export interface IntentUpdate {
  status?: IntentStatus;
  settledAt?: string | null;
  receiptId?: string | null;
  reasons?: string[];
  refundedMinor?: number;
}

export interface Store {
  /** The operator's audit-signing key, generated and persisted on first init. */
  operatorKey(): string;

  /** Operator-controlled flags (kill switch, circuit-breaker counter). Persistent
   * and operator-only — there is no agent tool that writes these. */
  getMeta(key: string): string | undefined;
  setMeta(key: string, value: string): void;

  insertMandate(m: Mandate): void;
  getMandate(id: string): Mandate | undefined;
  listMandates(): Mandate[];
  listActiveMandates(now: string): Mandate[];
  revokeMandate(id: string): void;
  /** Apply a partial change to a mandate (amend caps / extend expiry / scope). */
  updateMandate(id: string, patch: Partial<Mandate>): void;

  insertIntent(s: StoredIntent): void;
  getIntent(id: string): StoredIntent | undefined;
  listPendingIntents(): StoredIntent[];
  updateIntent(id: string, update: IntentUpdate): void;

  insertReceipt(r: Receipt): void;
  getReceipt(id: string): Receipt | undefined;

  /** Settled spend attributed to `mandateId` within its current period. */
  periodSpend(mandateId: string, now: string): PriorSpend[];
  /** Payees with at least one settled payment (novelty check). */
  knownPayees(): ReadonlySet<string>;
  /** Number of settled payments to a payee (trust trajectory). */
  payeeSettledCount(payee: string): number;

  appendAudit(e: AuditEntry): void;
  loadAudit(): AuditEntry[];
}

/** Start of the current period in UTC, for rolling budget + velocity windows. */
export function periodStart(now: string, period: Period): string {
  const d = new Date(now);
  if (period === "day") {
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    ).toISOString();
  }
  if (period === "month") {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
  }
  // week: most recent Monday 00:00 UTC
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  const monday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceMonday),
  );
  return monday.toISOString();
}
