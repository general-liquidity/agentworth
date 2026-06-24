import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateGate,
  isLiveMandate,
  DEFAULT_DENY_RULES,
  DEFAULT_GATE_CONFIG,
  RAIL_REVERSIBILITY,
} from "../src/portable.ts";
import type { GateContext, Mandate, PaymentIntent, RailKind } from "../src/portable.ts";

// Property-based fuzz over the crown-jewel invariant. A seeded LCG makes failures
// reproducible. We assert the load-bearing safety properties hold across a wide
// random space of (intent, mandate-set) — without reimplementing the gate (which
// would just let a shared bug pass): the checks read the gate's OWN output.

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const RAILS: RailKind[] = ["card", "checkout", "onchain"];
const CLASSES = ["groceries", "saas", "payouts", "misc"];
const NOW = "2026-06-24T12:00:00.000Z";

function genIntent(r: () => number): PaymentIntent {
  return {
    id: `pi_${Math.floor(r() * 1e6)}`,
    payee: `payee_${Math.floor(r() * 8)}`,
    payeeClass: CLASSES[Math.floor(r() * CLASSES.length)],
    amount: 1 + Math.floor(r() * 2_000_00),
    currency: "GBP",
    rail: RAILS[Math.floor(r() * RAILS.length)],
    rationale: "fuzz intent rationale text",
    createdAt: NOW,
  };
}

function genMandate(r: () => number, i: number): Mandate {
  const cls = CLASSES[Math.floor(r() * CLASSES.length)];
  const rails = RAILS.filter(() => r() > 0.4);
  return {
    id: `m_${i}`,
    label: cls,
    scope: { kind: "class", value: cls },
    currency: "GBP",
    allowedRails: rails.length ? rails : ["card"],
    perTxCap: 1 + Math.floor(r() * 2_000_00),
    perPeriodCap: 1 + Math.floor(r() * 5_000_00),
    period: "week",
    grantedAt: "2026-06-01T00:00:00.000Z",
    // ~30% expired
    expiresAt: r() > 0.3 ? "2026-12-31T00:00:00.000Z" : "2026-06-10T00:00:00.000Z",
    status: r() > 0.15 ? "active" : "revoked",
  };
}

test("evaluateGate upholds its safety invariants across 2000 fuzzed scenarios", () => {
  const r = lcg(0xC0FFEE);
  for (let iter = 0; iter < 2000; iter++) {
    const intent = genIntent(r);
    const mandates: Mandate[] = [];
    const n = Math.floor(r() * 3); // 0..2 mandates
    for (let i = 0; i < n; i++) mandates.push(genMandate(r, i));
    const known = new Set<string>();
    if (r() > 0.5) known.add(intent.payee);

    const ctx: GateContext = {
      now: NOW,
      mandates,
      periodSpendByMandate: () => [],
      knownPayees: known,
      denyRules: DEFAULT_DENY_RULES,
      config: DEFAULT_GATE_CONFIG,
      reversibility: RAIL_REVERSIBILITY[intent.rail],
    };

    const d = evaluateGate(intent, ctx);
    const tag = `iter ${iter} intent ${JSON.stringify(intent)}`;

    // INV-deny: if a hard deny rule matches, the outcome MUST be block.
    const denyHit = DEFAULT_DENY_RULES.some((rule) =>
      rule.match(intent, { knownPayees: known, reversibility: RAIL_REVERSIBILITY[intent.rail] } as never),
    );
    if (denyHit) assert.equal(d.outcome, "block", `deny rule matched but not blocked — ${tag}`);

    if (d.outcome === "auto_execute") {
      // INV1: an auto-execute names the covering mandate it relied on.
      assert.ok(d.mandateId, `auto_execute with no mandateId — ${tag}`);
      const m = mandates.find((x) => x.id === d.mandateId);
      assert.ok(m, `auto_execute names a mandate not in the set — ${tag}`);
      // INV2: that mandate is live (active + unexpired) ...
      assert.equal(isLiveMandate(m!, NOW), true, `auto_execute under a non-live mandate — ${tag}`);
      // INV3: ... allows the rail ...
      assert.ok(m!.allowedRails.includes(intent.rail), `auto_execute on a rail the mandate forbids — ${tag}`);
      // INV4: ... and the amount is within its per-tx cap.
      assert.ok(intent.amount <= m!.perTxCap, `auto_execute over the per-tx cap — ${tag}`);
    }

    // INV5: with NO live mandate covering the (class, rail, currency), never auto-execute.
    const hasLiveCover = mandates.some(
      (m) =>
        isLiveMandate(m, NOW) &&
        m.currency === intent.currency &&
        m.allowedRails.includes(intent.rail) &&
        m.scope.kind === "class" &&
        m.scope.value === intent.payeeClass,
    );
    if (!hasLiveCover) {
      assert.notEqual(d.outcome, "auto_execute", `auto_execute with no covering live mandate — ${tag}`);
    }
  }
});
