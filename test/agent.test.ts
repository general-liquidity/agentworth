import { test } from "node:test";
import assert from "node:assert/strict";

import { AuditLog } from "../src/core/audit.ts";
import { createExecutor } from "../src/core/executor.ts";
import { createMemoryStore } from "../src/store/memoryStore.ts";
import { createRailRegistry } from "../src/rails/registry.ts";
import { createFakeRail } from "../src/rails/fakeRail.ts";
import { DEFAULT_DENY_RULES } from "../src/core/denyList.ts";
import { DEFAULT_GATE_CONFIG, type Mandate } from "../src/core/types.ts";
import { runAgentTurn } from "../src/agent/loop.ts";
import { createStubModel } from "../src/agent/stubModel.ts";
import type { ModelProvider } from "../src/agent/model.ts";

const NOW = "2026-05-29T12:00:00.000Z";

function setup(model: ModelProvider) {
  const store = createMemoryStore("test-key");
  store.insertMandate({
    id: "m_groceries",
    label: "groceries",
    scope: { kind: "class", value: "groceries" },
    currency: "GBP",
    allowedRails: ["card"],
    perTxCap: 500_00,
    perPeriodCap: 1000_00,
    period: "week",
    grantedAt: "2026-05-26T00:00:00.000Z",
    expiresAt: "2026-06-26T00:00:00.000Z",
    status: "active",
  } satisfies Mandate);
  const audit = new AuditLog(store.operatorKey());
  const executor = createExecutor({
    store,
    rails: createRailRegistry([createFakeRail("card")]),
    audit,
    config: DEFAULT_GATE_CONFIG,
    denyRules: DEFAULT_DENY_RULES,
    clock: () => NOW,
  });
  let seq = 0;
  return {
    store,
    deps: {
      model,
      executor,
      store,
      clock: () => NOW,
      newId: () => `pi_agent_${seq++}`,
    },
  };
}

test("agent proposal for a new payee is gated to pending, not auto-paid", async () => {
  const { deps } = setup(createStubModel());
  const r = await runAgentTurn(
    "PAY 8000 GBP tesco groceries card :: weekly shop",
    deps,
  );
  assert.equal(r.decision.kind, "pay");
  assert.ok(r.execution);
  // tesco is novel in a fresh store → the agent cannot auto-pay it.
  assert.equal(r.execution.status, "pending");
});

test("the agent has no spend path that bypasses the gate (over-cap → blocked)", async () => {
  const { deps } = setup(createStubModel());
  const r = await runAgentTurn(
    "PAY 600000 GBP tesco groceries card :: buying the whole store",
    deps,
  );
  assert.ok(r.execution);
  assert.equal(r.execution.status, "blocked"); // 6000.00 > 500.00 per-tx cap
});

test("a non-payment goal returns a message and moves no money", async () => {
  const { store, deps } = setup(createStubModel());
  const r = await runAgentTurn("what's my grocery budget?", deps);
  assert.equal(r.decision.kind, "message");
  assert.equal(r.execution, null);
  assert.equal(store.listPendingIntents().length, 0);
});

test("a malformed draft from the model is rejected at the boundary", async () => {
  // A rogue/buggy model that emits a non-positive amount.
  const rogue: ModelProvider = {
    propose: () =>
      Promise.resolve({
        kind: "pay",
        draft: {
          payee: "x",
          payeeClass: "groceries",
          amount: -5,
          currency: "GBP",
          rail: "card",
          rationale: "negative",
        },
      }),
  };
  const { deps } = setup(rogue);
  await assert.rejects(() => runAgentTurn("anything", deps));
});
