import test from "node:test";
import assert from "node:assert/strict";

import {
  approvalNotification,
  formatNotification,
  webhookNotifier,
  consoleNotifier,
  type FetchLike,
  type Notification,
} from "../src/notify/notifier.ts";
import { AuditLog } from "../src/core/audit.ts";
import { createExecutor } from "../src/core/executor.ts";
import { createMemoryStore } from "../src/store/memoryStore.ts";
import { createRailRegistry } from "../src/rails/registry.ts";
import { createFakeRail } from "../src/rails/fakeRail.ts";
import { DEFAULT_DENY_RULES } from "../src/core/denyList.ts";
import { DEFAULT_GATE_CONFIG, type PaymentIntent } from "../src/core/types.ts";

const NOW = "2026-06-24T12:00:00.000Z";

function intent(over: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    id: "pi_1",
    payee: "newvendor",
    payeeClass: "misc",
    amount: 5000_00,
    currency: "GBP",
    rail: "card",
    rationale: "a payment with no covering mandate",
    createdAt: NOW,
    ...over,
  };
}

test("approvalNotification carries the glanceable fields", () => {
  const n = approvalNotification(intent(), { outcome: "confirm_operator", reasons: ["new payee"], mandateId: null, risk: { tier: "low", score: 1, reasons: [] }, remainingPeriodBudget: null }, NOW);
  assert.equal(n.kind, "approval_required");
  assert.equal(n.intentId, "pi_1");
  assert.equal(n.payee, "newvendor");
  assert.match(formatNotification(n), /Approval needed: pay 5000 GBP to newvendor/);
});

test("webhookNotifier POSTs the notification and never throws on failure", async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const okFetch: FetchLike = async (url, init) => {
    calls.push({ url, body: init.body });
    return { ok: true, status: 200 };
  };
  const n: Notification = {
    kind: "approval_required",
    intentId: "pi_9",
    amount: 1234,
    currency: "GBP",
    payee: "x",
    reasons: ["over cap"],
    at: NOW,
  };
  await webhookNotifier({ url: "https://hook.example/op", fetch: okFetch, token: "t" }).notify(n);
  assert.equal(calls.length, 1);
  assert.match(calls[0].body, /pi_9/);
  assert.match(calls[0].body, /"message"/); // human line included

  // a throwing fetch is swallowed (best-effort contract)
  const badFetch: FetchLike = async () => {
    throw new Error("network down");
  };
  await assert.doesNotReject(() => webhookNotifier({ url: "x", fetch: badFetch }).notify(n));
});

test("the executor fires a notification on a pending (confirm_operator) result", async () => {
  const store = createMemoryStore("k");
  // no mandate covering "misc" → confirm_operator
  const fired: Notification[] = [];
  const executor = createExecutor({
    store,
    rails: createRailRegistry([createFakeRail("card")]),
    audit: new AuditLog(store.operatorKey()),
    config: DEFAULT_GATE_CONFIG,
    denyRules: DEFAULT_DENY_RULES,
    clock: () => NOW,
    notifier: { async notify(n) { fired.push(n); } },
  });
  const r = await executor.execute(intent());
  assert.equal(r.status, "pending");
  // notify is fired-and-not-awaited; flush the microtask queue then assert.
  await Promise.resolve();
  assert.equal(fired.length, 1);
  assert.equal(fired[0].intentId, "pi_1");
});

test("a settled (auto-approved) payment fires NO approval notification", async () => {
  const store = createMemoryStore("k");
  store.insertMandate({
    id: "m", label: "misc", scope: { kind: "class", value: "misc" }, currency: "GBP",
    allowedRails: ["card"], perTxCap: 100000_00, perPeriodCap: 100000_00, period: "week",
    grantedAt: "2026-06-20T00:00:00.000Z", expiresAt: "2026-07-20T00:00:00.000Z", status: "active",
  });
  // Seed a prior settled payment so the payee is KNOWN (a brand-new payee routes to
  // confirm on first contact — that's the pending path, tested above). We want the
  // auto-settle path here.
  store.insertIntent({
    intent: intent({ id: "pi_seed", amount: 10_00 }), status: "settled",
    mandateId: "m", reasons: [], settledAt: NOW, receiptId: "r_seed",
  });
  const fired: Notification[] = [];
  const executor = createExecutor({
    store, rails: createRailRegistry([createFakeRail("card")]), audit: new AuditLog(store.operatorKey()),
    config: DEFAULT_GATE_CONFIG, denyRules: DEFAULT_DENY_RULES, clock: () => NOW,
    notifier: { async notify(n) { fired.push(n); } },
  });
  const r = await executor.execute(intent({ amount: 10_00 }));
  await Promise.resolve();
  assert.equal(r.status, "settled");
  assert.equal(fired.length, 0);
});

test("consoleNotifier resolves without throwing", async () => {
  await assert.doesNotReject(() =>
    consoleNotifier().notify({ kind: "approval_required", intentId: "i", amount: 1, currency: "GBP", payee: "p", reasons: [], at: NOW }),
  );
});
