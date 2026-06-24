import test from "node:test";
import assert from "node:assert/strict";

import { handleIngress, type IngressDeps } from "../src/ingress/server.ts";
import { AuditLog } from "../src/core/audit.ts";
import { createExecutor } from "../src/core/executor.ts";
import { createMemoryStore } from "../src/store/memoryStore.ts";
import { createRailRegistry } from "../src/rails/registry.ts";
import { createFakeRail } from "../src/rails/fakeRail.ts";
import { DEFAULT_DENY_RULES } from "../src/core/denyList.ts";
import { DEFAULT_GATE_CONFIG, type Mandate } from "../src/core/types.ts";
import { VerificationCache } from "../src/disclosure/index.ts";

const NOW = "2026-06-24T12:00:00.000Z";

// A node that ALSO offers verifier-as-a-service (POST /verify-disclosure), with a
// configured policy + a validity-window cache.
function node() {
  const store = createMemoryStore("svc-key");
  store.insertMandate({
    id: "m1", label: "groceries", scope: { kind: "class", value: "groceries" }, currency: "GBP",
    allowedRails: ["card"], perTxCap: 500_00, perPeriodCap: 1000_00, period: "week",
    grantedAt: "2026-06-20T00:00:00.000Z", expiresAt: "2026-07-20T00:00:00.000Z", status: "active",
  } satisfies Mandate);
  const audit = new AuditLog(store.operatorKey());
  audit.append("gate.decision", { intentId: "pi1", outcome: "auto_execute" }, NOW);
  const executor = createExecutor({
    store, rails: createRailRegistry([createFakeRail("card")]), audit,
    config: DEFAULT_GATE_CONFIG, denyRules: DEFAULT_DENY_RULES, clock: () => NOW,
  });
  let n = 0;
  const deps: IngressDeps = {
    executor, clock: () => NOW, newId: () => `n${n++}`, store,
    disclosure: {
      audit,
      operator: { id: "op", deniabilityBoundary: "spend within mandates only" },
      verifierPolicy: { requireEnforcedConstitution: true, requireAuditAnchor: true },
      verificationCache: new VerificationCache(),
    },
  };
  return deps;
}

test("POST /verify-disclosure verifies a posted disclosure and reports the tier", async () => {
  const deps = node();
  const discRes = await handleIngress("GET", "/.well-known/agent-disclosure", "", deps);
  const signed = discRes.body;

  const v1 = await handleIngress("POST", "/verify-disclosure", JSON.stringify(signed), deps);
  assert.equal(v1.status, 200);
  const b1 = v1.body as { decision: string; tier: string; cost: { checksRun: number } };
  assert.equal(b1.decision, "transact");
  assert.equal(b1.tier, "fresh");
  assert.ok(b1.cost.checksRun > 0);

  // same disclosure within its window -> served from cache (the economic enabler)
  const v2 = await handleIngress("POST", "/verify-disclosure", JSON.stringify(signed), deps);
  assert.equal((v2.body as { tier: string }).tier, "cached");
});

test("POST /verify-disclosure returns 400 on malformed input", async () => {
  const deps = node();
  const r = await handleIngress("POST", "/verify-disclosure", "{not json", deps);
  assert.equal(r.status, 400);
});

test("POST /verify-disclosure refuses a tampered disclosure (signature no longer holds)", async () => {
  const deps = node();
  const discRes = await handleIngress("GET", "/.well-known/agent-disclosure", "", deps);
  const signed = JSON.parse(JSON.stringify(discRes.body)) as { disclosure: { constitution: { enforced: boolean } } };
  // flipping a disclosed claim breaks the ed25519 signature over the canonical doc
  signed.disclosure.constitution.enforced = false;
  const r = await handleIngress("POST", "/verify-disclosure", JSON.stringify(signed), deps);
  assert.equal(r.status, 200);
  const body = r.body as { decision: string; reasons: string[] };
  assert.equal(body.decision, "refuse");
});
