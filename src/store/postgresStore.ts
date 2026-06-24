// Postgres-backed Store — durable, server-grade persistence.
//
// The architectural constraint: the `Store` interface is SYNCHRONOUS (the executor
// builds the gate context from it without awaiting, which keeps the gate pure and
// every other call site simple), but Postgres drivers are async. Rather than make
// the whole codebase async (a refactor through the safety-critical executor), this
// adapter keeps the sync contract via a proven split:
//
//   • Postgres is the durable SOURCE OF TRUTH (every write is persisted there).
//   • An in-process MIRROR (a MemoryStore) serves all synchronous reads — this is
//     not a new memory cost: the audit chain is already fully held in memory by
//     `AuditLog`, and the bounded state (mandates/intents/receipts/meta) is small.
//   • Writes update the mirror synchronously AND enqueue a serialized async persist
//     to Postgres. A `flush()` barrier resolves when all enqueued writes are durable.
//
// The executor awaits that barrier after each payment operation (the injected
// `commit` dep), so once `execute()`/`approve()` resolves, its writes are durable
// in Postgres — the same guarantee as awaiting an async DB write, without write-
// behind data-loss risk.
//
// SCOPE / honest limits:
//   • Single writer. The mirror assumes this process is the only writer; multiple
//     instances sharing one database would need cache invalidation (LISTEN/NOTIFY)
//     — that's a follow-on, documented, not built.
//   • The live `pg` client is INJECTED (operator brings `pg.Pool`), matching the
//     rail/identity injection pattern — no hard `pg` dependency in this repo.
//   • Operator-control meta writes (kill switch, mandate grant) enqueue a persist
//     but aren't on the auto-flushed payment path; in a short-lived process await
//     `flush()` after them. The payment-execution path is always flushed.

import { randomBytes } from "node:crypto";
import { createMemoryStore } from "./memoryStore.ts";
import type { AuditEntry } from "../core/audit.ts";
import type { Store } from "../core/store.ts";

/** The minimal node-postgres surface this adapter needs. An operator satisfies it
 *  with a `pg.Pool` / `pg.Client` (whose `.query(text, params)` returns `{rows}`). */
export interface PgClient {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS os_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS os_mandates (id TEXT PRIMARY KEY, data JSONB NOT NULL);
  CREATE TABLE IF NOT EXISTS os_intents (id TEXT PRIMARY KEY, data JSONB NOT NULL);
  CREATE TABLE IF NOT EXISTS os_receipts (id TEXT PRIMARY KEY, data JSONB NOT NULL);
  CREATE TABLE IF NOT EXISTS os_audit (seq INTEGER PRIMARY KEY, data JSONB NOT NULL);
`;

/** JSONB round-trips as a parsed object from node-pg, but a fake client (or a
 *  text column) may hand back a string — accept both. */
function asObject<T>(data: unknown): T {
  return (typeof data === "string" ? JSON.parse(data) : data) as T;
}

export interface PostgresStoreHandle {
  store: Store;
  /** Resolves once the schema is applied and existing state is loaded into the
   *  mirror. Callers MUST await this before using `store`. */
  ready: Promise<void>;
  /** Resolves when all enqueued writes are durable in Postgres. Wire this as the
   *  executor's `commit` barrier; await it after operator-control writes too. */
  flush: () => Promise<void>;
}

export function createPostgresStore(client: PgClient): PostgresStoreHandle {
  let mirror: Store | undefined;
  const requireMirror = (): Store => {
    if (!mirror) throw new Error("postgres store used before `ready` resolved");
    return mirror;
  };

  // Serialized write queue: preserves ordering (the audit chain is hash-linked, so
  // order matters), runs every write even if one fails, and surfaces the first
  // error on the next flush (then clears so the store can continue).
  let pending: Promise<void> = Promise.resolve();
  let firstError: unknown;
  function enqueue(fn: () => Promise<unknown>): void {
    pending = pending.then(async () => {
      try {
        await fn();
      } catch (e) {
        if (firstError === undefined) firstError = e;
      }
    });
  }
  async function flush(): Promise<void> {
    await pending;
    if (firstError !== undefined) {
      const e = firstError;
      firstError = undefined;
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  // UPSERT helpers — every mutation re-persists the affected entity's CURRENT state
  // read back from the mirror, so partial updates (revoke/amend/updateIntent) need
  // no per-field SQL.
  const upsert = (table: string, id: string, data: unknown) =>
    enqueue(() =>
      client.query(
        `INSERT INTO ${table} (id, data) VALUES ($1, $2) ` +
          `ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
        [id, JSON.stringify(data)],
      ),
    );
  const persistMandate = (id: string) => upsert("os_mandates", id, requireMirror().getMandate(id));
  const persistIntent = (id: string) => upsert("os_intents", id, requireMirror().getIntent(id));

  const store: Store = {
    operatorKey: () => requireMirror().operatorKey(),
    getMeta: (k) => requireMirror().getMeta(k),
    setMeta: (k, v) => {
      requireMirror().setMeta(k, v);
      enqueue(() =>
        client.query(
          "INSERT INTO os_meta (key, value) VALUES ($1, $2) " +
            "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
          [k, v],
        ),
      );
    },

    insertMandate(m) {
      requireMirror().insertMandate(m);
      persistMandate(m.id);
    },
    getMandate: (id) => requireMirror().getMandate(id),
    listMandates: () => requireMirror().listMandates(),
    listActiveMandates: (now) => requireMirror().listActiveMandates(now),
    revokeMandate(id) {
      requireMirror().revokeMandate(id);
      persistMandate(id);
    },
    updateMandate(id, patch) {
      requireMirror().updateMandate(id, patch);
      persistMandate(id);
    },

    insertIntent(s) {
      requireMirror().insertIntent(s);
      persistIntent(s.intent.id);
    },
    getIntent: (id) => requireMirror().getIntent(id),
    listPendingIntents: () => requireMirror().listPendingIntents(),
    updateIntent(id, update) {
      requireMirror().updateIntent(id, update);
      persistIntent(id);
    },

    insertReceipt(r) {
      requireMirror().insertReceipt(r);
      upsert("os_receipts", r.id, r);
    },
    getReceipt: (id) => requireMirror().getReceipt(id),

    periodSpend: (mandateId, now) => requireMirror().periodSpend(mandateId, now),
    knownPayees: () => requireMirror().knownPayees(),
    payeeSettledCount: (payee) => requireMirror().payeeSettledCount(payee),

    appendAudit(e) {
      requireMirror().appendAudit(e);
      // Append-only, keyed by the chain sequence.
      enqueue(() =>
        client.query(
          "INSERT INTO os_audit (seq, data) VALUES ($1, $2) ON CONFLICT (seq) DO NOTHING",
          [e.seq, JSON.stringify(e)],
        ),
      );
    },
    loadAudit: () => requireMirror().loadAudit(),
  };

  async function init(): Promise<void> {
    await client.query(SCHEMA);

    // Operator audit key: persisted once, then stable forever (signature continuity).
    const keyRows = (await client.query("SELECT value FROM os_meta WHERE key = 'operator_key'")).rows;
    let key = keyRows[0]?.value as string | undefined;
    if (!key) {
      key = randomBytes(32).toString("hex");
      await client.query("INSERT INTO os_meta (key, value) VALUES ('operator_key', $1)", [key]);
    }

    const m = createMemoryStore(key);
    // Hydrate the mirror from the durable tables. These calls hit the mirror only —
    // they must NOT re-enqueue persists (the data is already in Postgres).
    for (const row of (await client.query("SELECT key, value FROM os_meta")).rows) {
      if (row.key !== "operator_key") m.setMeta(String(row.key), String(row.value));
    }
    for (const row of (await client.query("SELECT data FROM os_mandates")).rows) {
      m.insertMandate(asObject(row.data));
    }
    for (const row of (await client.query("SELECT data FROM os_intents")).rows) {
      m.insertIntent(asObject(row.data));
    }
    for (const row of (await client.query("SELECT data FROM os_receipts")).rows) {
      m.insertReceipt(asObject(row.data));
    }
    for (const row of (await client.query("SELECT data FROM os_audit ORDER BY seq ASC")).rows) {
      m.appendAudit(asObject<AuditEntry>(row.data));
    }
    mirror = m;
  }

  return { store, ready: init(), flush };
}
