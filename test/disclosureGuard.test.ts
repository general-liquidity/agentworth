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
import {
  guardSettlement,
  combineMutual,
  verifyCounterparty,
  type FetchLike,
} from "../src/disclosure/index.ts";

const NOW = "2026-06-24T12:00:00.000Z";

// An agent node served over an in-memory wire that routes fetch() into its ingress.
function agentNode(operatorId = "op") {
  const store = createMemoryStore(`${operatorId}-key`);
  store.insertMandate({
    id: "m1", label: "groceries", scope: { kind: "class", value: "groceries" }, currency: "GBP",
    allowedRails: ["card"], perTxCap: 500_00, perPeriodCap: 1000_00, period: "week",
    grantedAt: "2026-06-20T00:00:00.000Z", expiresAt: "2026-07-20T00:00:00.000Z", status: "active",
  } satisfies Mandate);
  const audit = new AuditLog(store.operatorKey());
  audit.append("gate.decision", { intentId: "pi1", outcome: "auto_execute" }, NOW);
  audit.append("payment.settled", { intentId: "pi1" }, NOW);

  const executor = createExecutor({
    store, rails: createRailRegistry([createFakeRail("card")]), audit,
    config: DEFAULT_GATE_CONFIG, denyRules: DEFAULT_DENY_RULES, clock: () => NOW,
  });
  let n = 0;
  const deps: IngressDeps = {
    executor, clock: () => NOW, newId: () => `n${n++}`, store,
    disclosure: { audit, operator: { id: operatorId, deniabilityBoundary: "spend within mandates only" } },
  };
  const fetch: FetchLike = async (url, init) => {
    const path = new URL(url).pathname;
    const out = await handleIngress(init?.method ?? "GET", path, init?.body ?? "", deps);
    return { ok: out.status >= 200 && out.status < 300, status: out.status, json: async () => out.body };
  };
  return { fetch };
}

test("guardSettlement allows a payee that clears the policy", async () => {
  const { fetch } = agentNode();
  const r = await guardSettlement(fetch, "http://payee", {
    now: NOW, requireEnforcedConstitution: true, requireNonCustodial: true, requireAuditAnchor: true,
  });
  assert.equal(r.allow, true);
  assert.equal(r.verdict.decision, "transact");
});

test("guardSettlement refuses a payee that fails the policy, before any value moves", async () => {
  const { fetch } = agentNode();
  const r = await guardSettlement(fetch, "http://payee", { now: NOW, requireRedTeam: true, minRedTeamGrade: "A" });
  assert.equal(r.allow, false);
  assert.ok(r.verdict.reasons.some((x) => /red-team/.test(x)));
});

test("guardSettlement fails closed when the payee is unreachable", async () => {
  const fetch: FetchLike = async () => {
    throw new Error("network down");
  };
  const r = await guardSettlement(fetch, "http://payee", { now: NOW });
  assert.equal(r.allow, false);
  assert.ok(r.verdict.reasons.some((x) => /unreachable/.test(x)));
});

test("combineMutual transacts only when BOTH sides clear", async () => {
  const alice = agentNode("alice");
  const bob = agentNode("bob");
  const ourViewOfThem = await verifyCounterparty(bob.fetch, "http://bob", { now: NOW });
  const theirViewOfUs = await verifyCounterparty(alice.fetch, "http://alice", { now: NOW });
  const m = combineMutual(ourViewOfThem, theirViewOfUs);
  assert.equal(m.decision, "transact");
});

test("combineMutual refuses when one side fails its check", async () => {
  const alice = agentNode("alice");
  const bob = agentNode("bob");
  const ourViewOfThem = await verifyCounterparty(bob.fetch, "http://bob", { now: NOW });
  // alice can't meet a red-team requirement -> the mutual exchange refuses
  const theirViewOfUs = await verifyCounterparty(alice.fetch, "http://alice", { now: NOW, requireRedTeam: true });
  const m = combineMutual(ourViewOfThem, theirViewOfUs);
  assert.equal(m.decision, "refuse");
  assert.ok(m.reasons.some((x) => x.startsWith("us:")));
});
