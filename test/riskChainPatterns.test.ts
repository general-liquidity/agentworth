import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRiskChain } from "../src/core/riskChain.ts";
import type { AuditEntry, AuditEventType } from "../src/core/audit.ts";
import type { PaymentIntent } from "../src/core/types.ts";

let seq = 0;
function entry(type: AuditEventType, ts: string, payload: unknown): AuditEntry {
  // riskChain only reads type/ts/payload; the hash fields are placeholders here.
  return { seq: seq++, ts, type, payload, prevHash: "x", hash: "x", sig: "x" };
}

function intent(over: Partial<PaymentIntent> = {}): PaymentIntent {
  return {
    id: over.id ?? "cur",
    payee: over.payee ?? "merchant",
    payeeClass: over.payeeClass ?? "groceries",
    amount: over.amount ?? 1_00,
    currency: over.currency ?? "USDC",
    rail: over.rail ?? "onchain",
    rationale: over.rationale ?? "buy item",
    createdAt: over.createdAt ?? "2026-05-01T01:00:00Z",
  };
}

function decisionEntry(ts: string, mandateId: string, amount: number, remaining: number): AuditEntry {
  return entry("gate.decision", ts, {
    intentId: "d",
    outcome: "auto_execute",
    mandateId,
    verdict: { remainingPeriodBudget: remaining },
    intent: { payee: "merchant", payeeClass: "groceries", amount, currency: "USDC", rail: "onchain" },
  });
}

const NOW = "2026-05-01T01:00:00Z";

test("DRAIN_AFTER_GRANT triggers when a payment empties a freshly-granted mandate", () => {
  const entries: AuditEntry[] = [
    entry("mandate.granted", "2026-05-01T00:30:00Z", { id: "mD", label: "big budget" }),
    // 95% of the 100_00 budget consumed 20m after grant, inside the 15m decision window
    decisionEntry("2026-05-01T00:50:00Z", "mD", 95_00, 5_00),
  ];

  const alert = evaluateRiskChain(intent(), entries, { now: NOW });
  assert.equal(alert.triggered, true);
  assert.equal(alert.type, "DRAIN_AFTER_GRANT");
  assert.match(alert.reason ?? "", /95%/);
});

test("a benign small payment against the same mandate does NOT trigger", () => {
  const entries: AuditEntry[] = [
    entry("mandate.granted", "2026-05-01T00:30:00Z", { id: "mD", label: "big budget" }),
    decisionEntry("2026-05-01T00:50:00Z", "mD", 10_00, 90_00), // only 10% consumed
  ];

  const alert = evaluateRiskChain(intent(), entries, { now: NOW });
  assert.equal(alert.triggered, false);
  assert.equal(alert.type, "NONE");
});

test("no trigger when the grant is absent from the audit (no manufactured positive)", () => {
  const entries: AuditEntry[] = [decisionEntry("2026-05-01T00:50:00Z", "mD", 95_00, 5_00)];
  const alert = evaluateRiskChain(intent(), entries, { now: NOW });
  assert.equal(alert.triggered, false);
});

test("window is anchored on opts.now: a drain outside the window is not picked up", () => {
  const entries: AuditEntry[] = [
    entry("mandate.granted", "2026-05-01T00:30:00Z", { id: "mD", label: "big budget" }),
    decisionEntry("2026-05-01T00:50:00Z", "mD", 95_00, 5_00),
  ];
  // Advance the trusted clock well past the 15m default window — decision falls out.
  const alert = evaluateRiskChain(intent(), entries, { now: "2026-05-01T03:00:00Z" });
  assert.equal(alert.triggered, false);
});

test("a drain landing long after grant does not trigger (drain-after-grant timing)", () => {
  const entries: AuditEntry[] = [
    entry("mandate.granted", "2026-04-30T12:00:00Z", { id: "mD", label: "big budget" }), // >60m before
    decisionEntry("2026-05-01T00:50:00Z", "mD", 95_00, 5_00),
  ];
  const alert = evaluateRiskChain(intent(), entries, { now: NOW });
  assert.equal(alert.triggered, false);
});

test("the detector only ever ESCALATES and never mutates its inputs", () => {
  const entries: AuditEntry[] = [
    entry("mandate.granted", "2026-05-01T00:30:00Z", { id: "mD", label: "big budget" }),
    decisionEntry("2026-05-01T00:50:00Z", "mD", 95_00, 5_00),
  ];
  const entriesSnapshot = structuredClone(entries);
  const cur = intent();
  const curSnapshot = structuredClone(cur);

  const alert = evaluateRiskChain(cur, entries, { now: NOW });

  // triggered always means escalate (a real type), never a relaxation/allow.
  if (alert.triggered) {
    assert.notEqual(alert.type, "NONE");
  } else {
    assert.equal(alert.type, "NONE");
  }
  // The result carries no "allow"/downgrade channel — only triggered + type + reason.
  assert.deepEqual(Object.keys(alert).sort(), ["reason", "triggered", "type"]);
  // Inputs are untouched.
  assert.deepEqual(entries, entriesSnapshot);
  assert.deepEqual(cur, curSnapshot);
});
