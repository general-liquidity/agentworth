import test from "node:test";
import assert from "node:assert/strict";

import {
  createPostgresStore,
  type PgClient,
  type PgNotificationListener,
} from "../src/store/postgresStore.ts";
import type { Mandate } from "../src/core/types.ts";

// A shared fake "Postgres database + NOTIFY bus" that several store instances
// connect to — the same tables (one database) plus a pg_notify fan-out, so we can
// prove cross-instance read coherence without a live server.
function fakeBackend() {
  const tables: Record<string, Map<string | number, unknown>> = {
    os_meta: new Map(),
    os_mandates: new Map(),
    os_intents: new Map(),
    os_receipts: new Map(),
    os_audit: new Map(),
  };
  const listeners: Array<(payload: string) => void> = [];

  function makeClient(): PgClient {
    return {
      async query(text: string, params: unknown[] = []) {
        const t = text.trim();
        if (t.startsWith("CREATE TABLE")) return { rows: [] };
        if (/pg_notify/.test(t)) {
          const payload = String(params[0]);
          // fan out asynchronously, like a real NOTIFY delivered to listeners
          for (const l of listeners) queueMicrotask(() => l(payload));
          return { rows: [] };
        }
        if (/INSERT INTO os_meta/.test(t)) {
          if (t.includes("'operator_key'")) tables.os_meta.set("operator_key", { key: "operator_key", value: params[0] });
          else tables.os_meta.set(String(params[0]), { key: params[0], value: params[1] });
          return { rows: [] };
        }
        if (/INSERT INTO os_(mandates|intents|receipts)/.test(t)) {
          const table = /os_(mandates|intents|receipts)/.exec(t)![0];
          tables[table].set(String(params[0]), { id: params[0], data: params[1] });
          return { rows: [] };
        }
        if (/INSERT INTO os_audit/.test(t)) {
          tables.os_audit.set(Number(params[0]), { seq: params[0], data: params[1] });
          return { rows: [] };
        }
        // SELECT-by-id (reload path)
        const byId = /SELECT (data|value) FROM os_(\w+) WHERE (id|key) = \$1/.exec(t);
        if (byId) {
          const table = `os_${byId[2]}`;
          const row = tables[table].get(table === "os_meta" ? String(params[0]) : String(params[0]));
          return { rows: row ? [row as Record<string, unknown>] : [] };
        }
        if (/SELECT value FROM os_meta WHERE key = 'operator_key'/.test(t)) {
          const row = tables.os_meta.get("operator_key") as { value: string } | undefined;
          return { rows: row ? [row] : [] };
        }
        if (/SELECT key, value FROM os_meta/.test(t)) return { rows: [...tables.os_meta.values()] as any };
        if (/SELECT data FROM os_mandates/.test(t)) return { rows: [...tables.os_mandates.values()] as any };
        if (/SELECT data FROM os_intents/.test(t)) return { rows: [...tables.os_intents.values()] as any };
        if (/SELECT data FROM os_receipts/.test(t)) return { rows: [...tables.os_receipts.values()] as any };
        if (/SELECT data FROM os_audit/.test(t)) {
          return { rows: [...tables.os_audit.values()].sort((a: any, b: any) => a.seq - b.seq) as any };
        }
        return { rows: [] };
      },
    };
  }

  const notifier: PgNotificationListener = {
    async listen(_channel, handler) {
      listeners.push(handler);
    },
  };

  return { makeClient, notifier };
}

const mandate: Mandate = {
  id: "m1", label: "groceries", scope: { kind: "class", value: "groceries" }, currency: "GBP",
  allowedRails: ["card"], perTxCap: 500_00, perPeriodCap: 1000_00, period: "week",
  grantedAt: "2026-06-20T00:00:00.000Z", expiresAt: "2026-07-20T00:00:00.000Z", status: "active",
};

const tick = () => new Promise((r) => setTimeout(r, 0));

test("a write on instance A becomes visible in instance B's mirror via NOTIFY", async () => {
  const be = fakeBackend();
  const a = createPostgresStore(be.makeClient(), { notifications: be.notifier });
  const b = createPostgresStore(be.makeClient(), { notifications: be.notifier });
  await Promise.all([a.ready, b.ready]);

  // B has never seen m1
  assert.equal(b.store.getMandate("m1"), undefined);

  // A grants it, flushes (which also fires the pg_notify)
  a.store.insertMandate(mandate);
  await a.flush();
  await tick(); // let the fan-out + B's reload run

  assert.equal(b.store.getMandate("m1")?.label, "groceries", "B saw A's new mandate");
});

test("a revocation on A propagates to B's mirror", async () => {
  const be = fakeBackend();
  const a = createPostgresStore(be.makeClient(), { notifications: be.notifier });
  const b = createPostgresStore(be.makeClient(), { notifications: be.notifier });
  await Promise.all([a.ready, b.ready]);

  a.store.insertMandate(mandate);
  await a.flush();
  await tick();
  assert.equal(b.store.getMandate("m1")?.status, "active");

  a.store.revokeMandate("m1");
  await a.flush();
  await tick();
  assert.equal(b.store.getMandate("m1")?.status, "revoked", "B saw the revocation");
});

test("meta changes (e.g. kill switch) propagate across instances", async () => {
  const be = fakeBackend();
  const a = createPostgresStore(be.makeClient(), { notifications: be.notifier });
  const b = createPostgresStore(be.makeClient(), { notifications: be.notifier });
  await Promise.all([a.ready, b.ready]);

  a.store.setMeta("kill_switch", "1");
  await a.flush();
  await tick();
  assert.equal(b.store.getMeta("kill_switch"), "1", "B saw the kill switch engage");
});

test("without a notifier wired, a store does not publish (single-writer mode is silent)", async () => {
  const be = fakeBackend();
  let notifies = 0;
  const client = be.makeClient();
  const wrapped: PgClient = {
    query: (t, p) => {
      if (/pg_notify/.test(t)) notifies++;
      return client.query(t, p);
    },
  };
  const a = createPostgresStore(wrapped); // no notifications option
  await a.ready;
  a.store.insertMandate(mandate);
  await a.flush();
  assert.equal(notifies, 0, "no pg_notify issued in single-writer mode");
});
