import test from "node:test";
import assert from "node:assert/strict";

import { authorizeIngress, bearerFrom, getIngressToken, setIngressToken } from "../src/ingress/auth.ts";
import { buildOpenApiDocument } from "../src/ingress/openapi.ts";
import { handleIngress, type IngressDeps } from "../src/ingress/server.ts";
import { AuditLog } from "../src/core/audit.ts";
import { createExecutor } from "../src/core/executor.ts";
import { createMemoryStore } from "../src/store/memoryStore.ts";
import { createRailRegistry } from "../src/rails/registry.ts";
import { createFakeRail } from "../src/rails/fakeRail.ts";
import { DEFAULT_DENY_RULES } from "../src/core/denyList.ts";
import { DEFAULT_GATE_CONFIG } from "../src/core/types.ts";

const NOW = "2026-06-24T12:00:00.000Z";

// ── auth unit ────────────────────────────────────────────────────────────────
test("no configured token → open (loopback dev posture)", () => {
  assert.deepEqual(authorizeIngress("/payment-intent", undefined, undefined), { ok: true });
});

test("configured token → request without/with wrong bearer is 401, correct passes", () => {
  const tok = "secret-123";
  assert.equal(authorizeIngress("/payment-intent", undefined, tok).status, 401);
  assert.equal(authorizeIngress("/payment-intent", "Bearer wrong", tok).status, 401);
  assert.deepEqual(authorizeIngress("/payment-intent", "Bearer secret-123", tok), { ok: true });
});

test("/health is always allowed even with a token configured", () => {
  assert.deepEqual(authorizeIngress("/health", undefined, "secret"), { ok: true });
});

test("bearerFrom parses the header case-insensitively", () => {
  assert.equal(bearerFrom("Bearer abc"), "abc");
  assert.equal(bearerFrom("bearer xyz"), "xyz");
  assert.equal(bearerFrom(undefined), undefined);
  assert.equal(bearerFrom("Basic q"), undefined);
});

test("get/set ingress token round-trips through meta", () => {
  const store = createMemoryStore("k");
  assert.equal(getIngressToken(store.getMeta.bind(store)), undefined);
  setIngressToken(store.setMeta.bind(store), "tok");
  assert.equal(getIngressToken(store.getMeta.bind(store)), "tok");
});

// ── openapi unit ─────────────────────────────────────────────────────────────
test("openapi document covers the live endpoints and stamps the version", () => {
  const doc = buildOpenApiDocument("1.2.3") as any;
  assert.equal(doc.openapi, "3.1.0");
  assert.equal(doc.info.version, "1.2.3");
  for (const p of ["/health", "/status", "/payment-intent"]) {
    assert.ok(doc.paths[p], `missing path ${p}`);
  }
  // /health declares no security; the doc declares a bearer scheme globally
  assert.deepEqual(doc.paths["/health"].get.security, []);
  assert.ok(doc.components.securitySchemes.bearerAuth);
});

// ── wired into handleIngress ─────────────────────────────────────────────────
function deps(extra: Partial<IngressDeps> = {}): IngressDeps {
  const store = createMemoryStore("k");
  const executor = createExecutor({
    store, rails: createRailRegistry([createFakeRail("card")]), audit: new AuditLog(store.operatorKey()),
    config: DEFAULT_GATE_CONFIG, denyRules: DEFAULT_DENY_RULES, clock: () => NOW,
  });
  return { executor, clock: () => NOW, newId: () => "pi_x", ...extra };
}

test("GET /openapi.json is served through the ingress handler", async () => {
  const r = await handleIngress("GET", "/openapi.json", "", deps({ version: "9.9.9" }));
  assert.equal(r.status, 200);
  assert.equal((r.body as any).info.version, "9.9.9");
});

test("with a token configured, /payment-intent without a bearer is 401 before the gate", async () => {
  const r = await handleIngress(
    "POST",
    "/payment-intent",
    JSON.stringify({ payee: "p", payeeClass: "misc", amount: 100, currency: "GBP", rail: "card", rationale: "x".repeat(12) }),
    deps({ ingressToken: () => "tok" }),
    undefined,
  );
  assert.equal(r.status, 401);
});

test("with a token configured, the correct bearer passes auth and reaches the gate", async () => {
  const r = await handleIngress(
    "POST",
    "/payment-intent",
    JSON.stringify({ payee: "p", payeeClass: "misc", amount: 100, currency: "GBP", rail: "card", rationale: "x".repeat(12) }),
    deps({ ingressToken: () => "tok" }),
    "Bearer tok",
  );
  // no covering mandate → pending (202), proving it passed auth into the gate
  assert.equal(r.status, 202);
});
