import test from "node:test";
import assert from "node:assert/strict";

import { createMultiTenantStore } from "../src/store/multiTenant.ts";
import { createMemoryStore } from "../src/store/memoryStore.ts";
import type { Mandate } from "../src/core/types.ts";

const mandate = (id: string, label: string): Mandate => ({
  id, label, scope: { kind: "class", value: label }, currency: "GBP",
  allowedRails: ["card"], perTxCap: 500_00, perPeriodCap: 1000_00, period: "week",
  grantedAt: "2026-06-20T00:00:00.000Z", expiresAt: "2026-07-20T00:00:00.000Z", status: "active",
});

test("each tenant gets its own store; the same id returns the same instance", () => {
  let created = 0;
  const mt = createMultiTenantStore((t) => { created++; return createMemoryStore(`key-${t}`); });
  const a1 = mt.forTenant("a");
  const a2 = mt.forTenant("a");
  const b = mt.forTenant("b");
  assert.equal(a1, a2); // cached
  assert.notEqual(a1, b);
  assert.equal(created, 2);
  assert.deepEqual(mt.tenants().sort(), ["a", "b"]);
});

test("tenants are structurally isolated — no data crosses the boundary", () => {
  const mt = createMultiTenantStore((t) => createMemoryStore(`key-${t}`));
  mt.forTenant("acme").insertMandate(mandate("m1", "groceries"));
  // tenant B sees nothing of A's
  assert.equal(mt.forTenant("globex").getMandate("m1"), undefined);
  assert.equal(mt.forTenant("globex").listMandates().length, 0);
  // and the operator keys differ (separate audit chains)
  assert.notEqual(mt.forTenant("acme").operatorKey(), mt.forTenant("globex").operatorKey());
});

test("evict drops the cached handle without deleting data", () => {
  const stores = new Map<string, ReturnType<typeof createMemoryStore>>();
  const mt = createMultiTenantStore((t) => {
    // a stable backing per tenant so re-creation sees prior data
    let s = stores.get(t);
    if (!s) { s = createMemoryStore(`key-${t}`); stores.set(t, s); }
    return s;
  });
  mt.forTenant("acme").insertMandate(mandate("m1", "groceries"));
  mt.evict("acme");
  assert.deepEqual(mt.tenants(), []);
  // re-instantiating reuses the backing store (data survived the eviction)
  assert.equal(mt.forTenant("acme").getMandate("m1")?.label, "groceries");
});

test("a missing tenantId is rejected", () => {
  const mt = createMultiTenantStore(() => createMemoryStore());
  assert.throws(() => mt.forTenant(""));
});
