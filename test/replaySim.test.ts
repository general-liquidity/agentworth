import { test } from "node:test";
import assert from "node:assert/strict";

import { AuditLog } from "../src/core/audit.ts";
import { createExecutor } from "../src/core/executor.ts";
import { createMemoryStore } from "../src/store/memoryStore.ts";
import { createRailRegistry } from "../src/rails/registry.ts";
import { createFakeRail } from "../src/rails/fakeRail.ts";
import { DEFAULT_DENY_RULES } from "../src/core/denyList.ts";
import { DEFAULT_GATE_CONFIG, type Mandate, type PaymentIntent } from "../src/core/types.ts";
import { replayAudit } from "../src/obs/replaySim.ts";

const NOW = "2026-05-30T12:00:00.000Z";

const baseMandate = (over: Partial<Mandate> = {}): Mandate => ({
  id: "m_saas",
  label: "saas",
  scope: { kind: "class", value: "saas" },
  currency: "USD",
  allowedRails: ["card"],
  perTxCap: 50_00,
  perPeriodCap: 200_00,
  period: "month",
  grantedAt: "2026-05-01T00:00:00.000Z",
  expiresAt: "2026-12-01T00:00:00.000Z",
  status: "active",
  ...over,
});

const intent = (over: Partial<PaymentIntent> = {}): PaymentIntent => ({
  id: "pi",
  payee: "exa",
  payeeClass: "saas",
  amount: 20_00,
  currency: "USD",
  rail: "card",
  rationale: "metered api usage",
  createdAt: NOW,
  ...over,
});

// Run a batch of intents through a real executor with a known mandate, then return
// the signed audit entries — the substrate the replay simulator runs against.
function recordHistory(mandate: Mandate) {
  const store = createMemoryStore("k");
  store.insertMandate(mandate);
  // Seed settled history so "exa" is a known + trusted payee at decision time.
  for (let i = 0; i < 3; i++) {
    store.insertIntent({
      intent: intent({ id: `seed_${i}` }),
      status: "settled",
      mandateId: mandate.id,
      reasons: [],
      settledAt: "2026-05-02T00:00:00.000Z",
      receiptId: `r_${i}`,
    });
  }
  const audit = new AuditLog(store.operatorKey());
  const executor = createExecutor({
    store,
    rails: createRailRegistry([createFakeRail("card")]),
    audit,
    config: DEFAULT_GATE_CONFIG,
    denyRules: DEFAULT_DENY_RULES,
    clock: () => NOW,
  });
  return { store, audit, executor };
}

test("replaying the same mandate set reproduces every recorded outcome (zero drift)", async () => {
  const mandate = baseMandate();
  const { audit, executor } = recordHistory(mandate);
  await executor.execute(intent({ id: "a", amount: 20_00 })); // auto
  await executor.execute(intent({ id: "b", amount: 80_00 })); // over perTxCap → block
  await executor.execute(intent({ id: "c", payee: "stranger", payeeClass: "gambling" })); // no mandate → confirm

  const report = replayAudit(audit.entries(), { mandates: [mandate] });
  assert.equal(report.total, 3);
  assert.equal(report.changed, 0);
  assert.equal(report.unchanged, 3);
});

test("a tighter candidate cap turns a previously auto-executed payment into a block", async () => {
  const mandate = baseMandate();
  const { audit, executor } = recordHistory(mandate);
  const r = await executor.execute(intent({ id: "a", amount: 40_00 }));
  assert.equal(r.status, "settled"); // auto under the 50_00 cap

  // Counterfactual: what if perTxCap had been 25_00?
  const tighter = baseMandate({ perTxCap: 25_00 });
  const report = replayAudit(audit.entries(), { mandates: [tighter] });
  const rec = report.records.find((x) => x.intentId === "a");
  assert.ok(rec);
  assert.equal(rec.original, "auto_execute");
  assert.equal(rec.replayed, "block");
  assert.equal(report.changed, 1);
});

test("a looser candidate cap turns a previously blocked payment into auto-execute", async () => {
  const mandate = baseMandate();
  const { audit, executor } = recordHistory(mandate);
  const r = await executor.execute(intent({ id: "a", amount: 80_00 }));
  assert.equal(r.status, "blocked"); // over the 50_00 perTxCap

  const looser = baseMandate({ perTxCap: 100_00 });
  const report = replayAudit(audit.entries(), { mandates: [looser] });
  const rec = report.records.find((x) => x.intentId === "a");
  assert.ok(rec);
  assert.equal(rec.original, "block");
  assert.equal(rec.replayed, "auto_execute");
});

test("replay reconstructs period budget: a candidate budget exhausts mid-history", async () => {
  const mandate = baseMandate({ perPeriodCap: 200_00 });
  const { audit, executor } = recordHistory(mandate);
  // Three 40_00 payments — all auto under a 200_00 monthly budget (120_00 total).
  await executor.execute(intent({ id: "a", amount: 40_00 }));
  await executor.execute(intent({ id: "b", amount: 40_00 }));
  await executor.execute(intent({ id: "c", amount: 40_00 }));

  // Candidate budget of 100_00: a(40)+b(40) fit, c(40) would exceed → block.
  const capped = baseMandate({ perPeriodCap: 100_00 });
  const report = replayAudit(audit.entries(), { mandates: [capped] });
  assert.equal(report.records.find((x) => x.intentId === "a")?.replayed, "auto_execute");
  assert.equal(report.records.find((x) => x.intentId === "b")?.replayed, "auto_execute");
  assert.equal(report.records.find((x) => x.intentId === "c")?.replayed, "block");
  assert.equal(report.changed, 1);
});

test("removing the covering mandate routes every payment to the operator", async () => {
  const mandate = baseMandate();
  const { audit, executor } = recordHistory(mandate);
  await executor.execute(intent({ id: "a", amount: 20_00 }));
  await executor.execute(intent({ id: "b", amount: 30_00 }));

  const report = replayAudit(audit.entries(), { mandates: [] });
  assert.equal(report.records.every((r) => r.replayed === "confirm_operator"), true);
});
