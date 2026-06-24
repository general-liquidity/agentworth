import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  evaluateGate,
  DEFAULT_DENY_RULES,
  DEFAULT_GATE_CONFIG,
  RAIL_REVERSIBILITY,
  isLiveMandate,
} from "../src/portable.ts";
import type { GateContext, PaymentIntent, Mandate } from "../src/portable.ts";

const NOW = "2026-06-24T12:00:00.000Z";

const mandate: Mandate = {
  id: "m", label: "groceries", scope: { kind: "class", value: "groceries" }, currency: "GBP",
  allowedRails: ["card"], perTxCap: 500_00, perPeriodCap: 1000_00, period: "week",
  grantedAt: "2026-06-20T00:00:00.000Z", expiresAt: "2026-07-20T00:00:00.000Z", status: "active",
};

function ctx(mandates: Mandate[], rail: PaymentIntent["rail"]): GateContext {
  return {
    now: NOW,
    mandates,
    periodSpendByMandate: () => [],
    knownPayees: new Set<string>(),
    denyRules: DEFAULT_DENY_RULES,
    config: DEFAULT_GATE_CONFIG,
    reversibility: RAIL_REVERSIBILITY[rail],
  };
}

test("the portable gate decides without any Node runtime", () => {
  const intent: PaymentIntent = { id: "pi", payee: "tesco", payeeClass: "groceries", amount: 80_00, currency: "GBP", rail: "card", rationale: "weekly shop", createdAt: NOW };
  const d = evaluateGate(intent, ctx([mandate], "card"));
  // covered + new payee → confirm_operator (the gate ran end-to-end, no Node)
  assert.ok(["auto_execute", "confirm_operator"].includes(d.outcome));
  assert.equal(isLiveMandate(mandate, NOW), true);
});

test("the portable kernel + its whole import graph is free of `node:` builtins", () => {
  // If any pure-gate file gains a Node dependency, the portable claim breaks — guard it.
  const here = fileURLToPath(new URL(".", import.meta.url));
  const graph = [
    "../src/portable.ts",
    "../src/core/gate.ts",
    "../src/core/types.ts",
    "../src/core/risk.ts",
    "../src/core/denyList.ts",
    "../src/core/trust.ts",
    "../src/core/reputation.ts",
    "../src/core/fx.ts",
  ];
  for (const rel of graph) {
    const src = readFileSync(here + rel, "utf8");
    assert.ok(!/from\s+["']node:/.test(src), `${rel} imports a node: builtin`);
    assert.ok(!/require\(["']node:/.test(src), `${rel} requires a node: builtin`);
  }
});
