// Multi-tenant operator isolation. A single hosted process can serve many
// operators, each with a STRUCTURALLY isolated store: a separate Store instance
// per tenant, created lazily by an injected factory. There is no shared-state path
// between tenants — one operator's mandates, intents, receipts, audit chain, and
// kill switch are unreachable from another's.
//
// This also keeps each tenant's signed audit chain single-writer (per-tenant
// AuditLog over a per-tenant store), sidestepping the cross-instance fork concern
// at the tenant boundary. Pair with `createPostgresStore` (one DB, distinct tenant
// stores) or `createSqliteStore` (a DB file per tenant) via the factory.

import type { Store } from "../core/store.ts";

export interface MultiTenantStore {
  /** The isolated Store for a tenant; created on first use and cached. */
  forTenant(tenantId: string): Store;
  /** Tenants instantiated so far. */
  tenants(): string[];
  /** Drop a tenant's cached store handle (e.g. on eviction). Does not delete data. */
  evict(tenantId: string): void;
}

/**
 * Build a multi-tenant store from a per-tenant factory. The factory receives the
 * tenant id and returns a fresh Store for it (e.g. `(t) => createSqliteStore(
 * \`./data/\${t}.db\`)`). Isolation is by construction — distinct Store instances,
 * no shared maps or tables crossing the tenant boundary.
 */
export function createMultiTenantStore(
  factory: (tenantId: string) => Store,
): MultiTenantStore {
  if (typeof factory !== "function") throw new Error("multi-tenant store needs a factory");
  const stores = new Map<string, Store>();
  return {
    forTenant(tenantId) {
      if (!tenantId) throw new Error("tenantId is required");
      let s = stores.get(tenantId);
      if (!s) {
        s = factory(tenantId);
        stores.set(tenantId, s);
      }
      return s;
    },
    tenants: () => [...stores.keys()],
    evict(tenantId) {
      stores.delete(tenantId);
    },
  };
}
