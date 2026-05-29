// In-memory Store. Used by the test suite (runs on any Node) and as a reference
// implementation of the persistence contract.

import { randomBytes } from "node:crypto";
import type { AuditEntry } from "../core/audit.ts";
import {
  periodStart,
  type IntentUpdate,
  type Store,
  type StoredIntent,
} from "../core/store.ts";
import { isLiveMandate } from "../core/gate.ts";
import type { Mandate, PriorSpend, Receipt } from "../core/types.ts";

export function createMemoryStore(operatorKey?: string): Store {
  const key = operatorKey ?? randomBytes(32).toString("hex");
  const mandates = new Map<string, Mandate>();
  const intents = new Map<string, StoredIntent>();
  const receipts = new Map<string, Receipt>();
  const audit: AuditEntry[] = [];

  const meta = new Map<string, string>();

  return {
    operatorKey: () => key,
    getMeta: (k) => meta.get(k),
    setMeta: (k, v) => {
      meta.set(k, v);
    },

    insertMandate(m) {
      if (mandates.has(m.id)) throw new Error(`mandate ${m.id} already exists`);
      mandates.set(m.id, m);
    },
    getMandate: (id) => mandates.get(id),
    listMandates: () => [...mandates.values()],
    listActiveMandates: (now) =>
      [...mandates.values()].filter((m) => isLiveMandate(m, now)),
    revokeMandate(id) {
      const m = mandates.get(id);
      if (m) mandates.set(id, { ...m, status: "revoked" });
    },
    updateMandate(id, patch) {
      const m = mandates.get(id);
      if (m) mandates.set(id, { ...m, ...patch, id });
    },

    insertIntent(s) {
      if (intents.has(s.intent.id)) {
        throw new Error(`intent ${s.intent.id} already exists`);
      }
      intents.set(s.intent.id, s);
    },
    getIntent: (id) => intents.get(id),
    listPendingIntents: () =>
      [...intents.values()].filter((s) => s.status === "pending"),
    updateIntent(id, update: IntentUpdate) {
      const s = intents.get(id);
      if (!s) throw new Error(`intent ${id} not found`);
      intents.set(id, {
        ...s,
        status: update.status ?? s.status,
        settledAt: update.settledAt ?? s.settledAt,
        receiptId: update.receiptId ?? s.receiptId,
        reasons: update.reasons ?? s.reasons,
        refundedMinor: update.refundedMinor ?? s.refundedMinor,
      });
    },

    insertReceipt(r) {
      receipts.set(r.id, r);
    },
    getReceipt: (id) => receipts.get(id),

    periodSpend(mandateId, now): PriorSpend[] {
      const m = mandates.get(mandateId);
      if (!m) return [];
      const start = periodStart(now, m.period);
      return [...intents.values()]
        .filter(
          (s) =>
            s.status === "settled" &&
            s.mandateId === mandateId &&
            s.settledAt !== null &&
            s.settledAt >= start,
        )
        .map((s) => ({
          amount: s.intent.amount - (s.refundedMinor ?? 0),
          at: s.settledAt as string,
        }));
    },
    knownPayees(): ReadonlySet<string> {
      const set = new Set<string>();
      for (const s of intents.values()) {
        if (s.status === "settled") set.add(s.intent.payee);
      }
      return set;
    },
    payeeSettledCount(payee): number {
      let n = 0;
      for (const s of intents.values()) {
        if (s.status === "settled" && s.intent.payee === payee) n++;
      }
      return n;
    },

    appendAudit(e) {
      audit.push(e);
    },
    loadAudit: () => [...audit],
  };
}
