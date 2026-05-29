import { test } from "node:test";
import assert from "node:assert/strict";

import { AuditLog } from "../src/core/audit.ts";
import { createMemoryStore } from "../src/store/memoryStore.ts";
import {
  createEarningDesk,
  evaluateInbound,
  type AcceptancePolicy,
  type EarningVerifier,
  type InboundPayment,
} from "../src/earn/earningDesk.ts";

const NOW = "2026-05-30T12:00:00.000Z";
const policy: AcceptancePolicy = {
  currency: "USDC",
  minPriceMinor: 1_00,
  allowedServices: ["research", "inference"],
};
const payment = (over: Partial<InboundPayment> = {}): InboundPayment => ({
  service: "research",
  amountMinor: 5_00,
  currency: "USDC",
  payer: "client-agent",
  ...over,
});

function makeDesk(verifier?: EarningVerifier) {
  const store = createMemoryStore("k");
  const audit = new AuditLog(store.operatorKey());
  const d = createEarningDesk({ store, audit, clock: () => NOW, policy, verifier });
  return { store, audit, desk: d };
}

test("evaluateInbound accepts a valid payment and rejects bad ones", () => {
  assert.equal(evaluateInbound(payment(), policy).accepted, true);
  assert.equal(evaluateInbound(payment({ amountMinor: 50 }), policy).accepted, false); // below min
  assert.equal(evaluateInbound(payment({ currency: "GBP" }), policy).accepted, false); // wrong currency
  assert.equal(evaluateInbound(payment({ service: "gambling" }), policy).accepted, false); // not offered
});

test("a quote is published and recorded to the audit log", () => {
  const { audit, desk } = makeDesk();
  const q = desk.quote("research", 5_00);
  assert.equal(q.priceMinor, 5_00);
  assert.equal(q.currency, "USDC");
  assert.ok(audit.entries().some((e) => e.type === "earning.quoted"));
});

test("a verified inbound payment is accepted and recorded as earned", async () => {
  const { audit, desk } = makeDesk({ verify: () => true });
  const r = await desk.receive(payment());
  assert.equal(r.accepted, true);
  assert.ok(audit.entries().some((e) => e.type === "earning.received"));
});

test("income is never recorded on faith — no verifier ⇒ rejected", async () => {
  const { audit, desk } = makeDesk(); // no verifier
  const r = await desk.receive(payment());
  assert.equal(r.accepted, false);
  assert.ok(audit.entries().some((e) => e.type === "earning.rejected"));
  assert.ok(!audit.entries().some((e) => e.type === "earning.received"));
});

test("a below-minimum payment is rejected before verification", async () => {
  const { desk } = makeDesk({ verify: () => true });
  const r = await desk.receive(payment({ amountMinor: 10 }));
  assert.equal(r.accepted, false);
});
