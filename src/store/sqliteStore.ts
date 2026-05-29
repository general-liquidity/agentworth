// node:sqlite Store — real persistence for production (Node >= 22.5).
// Integer minor-units, JSON columns for unions/arrays, idempotent
// CREATE TABLE IF NOT EXISTS migrations (FinancialClaw pattern). The operator
// audit key is generated once and stored in the meta table.

import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import type { AuditEntry } from "../core/audit.ts";
import {
  periodStart,
  type IntentStatus,
  type IntentUpdate,
  type Store,
  type StoredIntent,
} from "../core/store.ts";
import type {
  Mandate,
  PayeeScope,
  Period,
  PriorSpend,
  RailKind,
  Receipt,
} from "../core/types.ts";

interface MandateRow {
  id: string;
  label: string;
  scope: string;
  currency: string;
  allowed_rails: string;
  per_tx_cap: number;
  per_period_cap: number;
  period: string;
  granted_at: string;
  expires_at: string;
  status: string;
}

interface IntentRow {
  id: string;
  payee: string;
  payee_class: string;
  amount: number;
  currency: string;
  rail: string;
  rationale: string;
  created_at: string;
  status: string;
  mandate_id: string | null;
  reasons: string;
  settled_at: string | null;
  receipt_id: string | null;
  refunded_minor: number;
}

function rowToMandate(r: MandateRow): Mandate {
  return {
    id: r.id,
    label: r.label,
    scope: JSON.parse(r.scope) as PayeeScope,
    currency: r.currency,
    allowedRails: JSON.parse(r.allowed_rails) as RailKind[],
    perTxCap: r.per_tx_cap,
    perPeriodCap: r.per_period_cap,
    period: r.period as Period,
    grantedAt: r.granted_at,
    expiresAt: r.expires_at,
    status: r.status as Mandate["status"],
  };
}

function rowToStoredIntent(r: IntentRow): StoredIntent {
  return {
    intent: {
      id: r.id,
      payee: r.payee,
      payeeClass: r.payee_class,
      amount: r.amount,
      currency: r.currency,
      rail: r.rail as RailKind,
      rationale: r.rationale,
      createdAt: r.created_at,
    },
    status: r.status as IntentStatus,
    mandateId: r.mandate_id,
    reasons: JSON.parse(r.reasons) as string[],
    settledAt: r.settled_at,
    receiptId: r.receipt_id,
    refundedMinor: r.refunded_minor ?? 0,
  };
}

export function createSqliteStore(path: string): Store {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mandates (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, scope TEXT NOT NULL,
      currency TEXT NOT NULL, allowed_rails TEXT NOT NULL,
      per_tx_cap INTEGER NOT NULL, per_period_cap INTEGER NOT NULL,
      period TEXT NOT NULL, granted_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS intents (
      id TEXT PRIMARY KEY, payee TEXT NOT NULL, payee_class TEXT NOT NULL,
      amount INTEGER NOT NULL, currency TEXT NOT NULL, rail TEXT NOT NULL,
      rationale TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL,
      mandate_id TEXT, reasons TEXT NOT NULL, settled_at TEXT, receipt_id TEXT,
      refunded_minor INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY, intent_id TEXT NOT NULL UNIQUE, rail TEXT NOT NULL,
      amount INTEGER NOT NULL, currency TEXT NOT NULL, settled_at TEXT NOT NULL,
      provider_ref TEXT NOT NULL, finality TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit (
      seq INTEGER PRIMARY KEY, ts TEXT NOT NULL, type TEXT NOT NULL,
      payload TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL,
      sig TEXT NOT NULL
    );
  `);

  // Idempotent migration for databases created before refunds existed.
  try {
    db.exec("ALTER TABLE intents ADD COLUMN refunded_minor INTEGER NOT NULL DEFAULT 0");
  } catch {
    // column already present
  }

  // Operator key: generate once, persist forever.
  let key = (
    db.prepare("SELECT value FROM meta WHERE key = 'operator_key'").get() as
      | { value: string }
      | undefined
  )?.value;
  if (!key) {
    key = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO meta (key, value) VALUES ('operator_key', ?)").run(key);
  }
  const operatorKeyValue = key;

  return {
    operatorKey: () => operatorKeyValue,
    getMeta(k) {
      const r = db.prepare("SELECT value FROM meta WHERE key = ?").get(k) as
        | { value: string }
        | undefined;
      return r?.value;
    },
    setMeta(k, v) {
      db.prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(k, v);
    },

    insertMandate(m) {
      db.prepare(
        `INSERT INTO mandates (id,label,scope,currency,allowed_rails,per_tx_cap,
          per_period_cap,period,granted_at,expires_at,status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        m.id,
        m.label,
        JSON.stringify(m.scope),
        m.currency,
        JSON.stringify(m.allowedRails),
        m.perTxCap,
        m.perPeriodCap,
        m.period,
        m.grantedAt,
        m.expiresAt,
        m.status,
      );
    },
    getMandate(id) {
      const r = db.prepare("SELECT * FROM mandates WHERE id = ?").get(id) as
        | MandateRow
        | undefined;
      return r ? rowToMandate(r) : undefined;
    },
    listMandates() {
      return (
        db.prepare("SELECT * FROM mandates").all() as unknown as MandateRow[]
      ).map(rowToMandate);
    },
    listActiveMandates(now) {
      return (
        db
          .prepare(
            "SELECT * FROM mandates WHERE status = 'active' AND expires_at > ?",
          )
          .all(now) as unknown as MandateRow[]
      ).map(rowToMandate);
    },
    revokeMandate(id) {
      db.prepare("UPDATE mandates SET status = 'revoked' WHERE id = ?").run(id);
    },
    updateMandate(id, patch) {
      const current = this.getMandate(id);
      if (!current) return;
      const m = { ...current, ...patch, id };
      db.prepare(
        `UPDATE mandates SET label=?,scope=?,currency=?,allowed_rails=?,per_tx_cap=?,
          per_period_cap=?,period=?,granted_at=?,expires_at=?,status=? WHERE id=?`,
      ).run(
        m.label,
        JSON.stringify(m.scope),
        m.currency,
        JSON.stringify(m.allowedRails),
        m.perTxCap,
        m.perPeriodCap,
        m.period,
        m.grantedAt,
        m.expiresAt,
        m.status,
        id,
      );
    },

    insertIntent(s) {
      db.prepare(
        `INSERT INTO intents (id,payee,payee_class,amount,currency,rail,rationale,
          created_at,status,mandate_id,reasons,settled_at,receipt_id,refunded_minor)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        s.intent.id,
        s.intent.payee,
        s.intent.payeeClass,
        s.intent.amount,
        s.intent.currency,
        s.intent.rail,
        s.intent.rationale,
        s.intent.createdAt,
        s.status,
        s.mandateId,
        JSON.stringify(s.reasons),
        s.settledAt,
        s.receiptId,
        s.refundedMinor ?? 0,
      );
    },
    getIntent(id) {
      const r = db.prepare("SELECT * FROM intents WHERE id = ?").get(id) as
        | IntentRow
        | undefined;
      return r ? rowToStoredIntent(r) : undefined;
    },
    listPendingIntents() {
      return (
        db.prepare("SELECT * FROM intents WHERE status = 'pending'").all() as
          unknown as IntentRow[]
      ).map(rowToStoredIntent);
    },
    updateIntent(id, update: IntentUpdate) {
      const current = db.prepare("SELECT * FROM intents WHERE id = ?").get(id) as
        | IntentRow
        | undefined;
      if (!current) throw new Error(`intent ${id} not found`);
      db.prepare(
        `UPDATE intents SET status = ?, settled_at = ?, receipt_id = ?, reasons = ?,
          refunded_minor = ? WHERE id = ?`,
      ).run(
        update.status ?? current.status,
        update.settledAt ?? current.settled_at,
        update.receiptId ?? current.receipt_id,
        update.reasons ? JSON.stringify(update.reasons) : current.reasons,
        update.refundedMinor ?? current.refunded_minor,
        id,
      );
    },

    insertReceipt(r) {
      db.prepare(
        `INSERT INTO receipts (id,intent_id,rail,amount,currency,settled_at,
          provider_ref,finality) VALUES (?,?,?,?,?,?,?,?)`,
      ).run(
        r.id,
        r.intentId,
        r.rail,
        r.amount,
        r.currency,
        r.settledAt,
        r.providerRef,
        r.finality,
      );
    },
    getReceipt(id) {
      const r = db.prepare("SELECT * FROM receipts WHERE id = ?").get(id) as
        | {
            id: string;
            intent_id: string;
            rail: string;
            amount: number;
            currency: string;
            settled_at: string;
            provider_ref: string;
            finality: string;
          }
        | undefined;
      if (!r) return undefined;
      return {
        id: r.id,
        intentId: r.intent_id,
        rail: r.rail as RailKind,
        amount: r.amount,
        currency: r.currency,
        settledAt: r.settled_at,
        providerRef: r.provider_ref,
        finality: r.finality as Receipt["finality"],
      };
    },

    periodSpend(mandateId, now): PriorSpend[] {
      const m = this.getMandate(mandateId);
      if (!m) return [];
      const start = periodStart(now, m.period);
      return (
        db
          .prepare(
            `SELECT amount, refunded_minor, settled_at FROM intents
             WHERE status = 'settled' AND mandate_id = ? AND settled_at >= ?`,
          )
          .all(mandateId, start) as unknown as {
            amount: number;
            refunded_minor: number;
            settled_at: string;
          }[]
      ).map((r) => ({ amount: r.amount - (r.refunded_minor ?? 0), at: r.settled_at }));
    },
    knownPayees(): ReadonlySet<string> {
      const rows = db
        .prepare("SELECT DISTINCT payee FROM intents WHERE status = 'settled'")
        .all() as unknown as { payee: string }[];
      return new Set(rows.map((r) => r.payee));
    },
    payeeSettledCount(payee): number {
      const r = db
        .prepare(
          "SELECT COUNT(*) as n FROM intents WHERE status = 'settled' AND payee = ?",
        )
        .get(payee) as unknown as { n: number } | undefined;
      return r?.n ?? 0;
    },

    appendAudit(e: AuditEntry) {
      db.prepare(
        `INSERT INTO audit (seq,ts,type,payload,prev_hash,hash,sig)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(
        e.seq,
        e.ts,
        e.type,
        JSON.stringify(e.payload),
        e.prevHash,
        e.hash,
        e.sig,
      );
    },
    loadAudit(): AuditEntry[] {
      return (
        db.prepare("SELECT * FROM audit ORDER BY seq ASC").all() as unknown as {
          seq: number;
          ts: string;
          type: string;
          payload: string;
          prev_hash: string;
          hash: string;
          sig: string;
        }[]
      ).map((r) => ({
        seq: r.seq,
        ts: r.ts,
        type: r.type as AuditEntry["type"],
        payload: JSON.parse(r.payload),
        prevHash: r.prev_hash,
        hash: r.hash,
        sig: r.sig,
      }));
    },
  };
}
