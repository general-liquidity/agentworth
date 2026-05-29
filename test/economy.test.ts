import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateGate } from "../src/core/gate.ts";
import { staticReputationSource, noReputation } from "../src/core/reputation.ts";
import { DEFAULT_DENY_RULES } from "../src/core/denyList.ts";
import {
  DEFAULT_GATE_CONFIG,
  type GateContext,
  type Mandate,
  type PaymentIntent,
  type ReputationLevel,
} from "../src/core/types.ts";
import {
  evaluateOffer,
  offerToIntent,
  staticCatalog,
  type ServiceOffer,
} from "../src/finance/offer.ts";

const NOW = "2026-05-30T12:00:00.000Z";
const mandate: Mandate = {
  id: "m",
  label: "saas",
  scope: { kind: "class", value: "saas" },
  currency: "GBP",
  allowedRails: ["card"],
  perTxCap: 500_00,
  perPeriodCap: 2000_00,
  period: "month",
  grantedAt: "2026-05-01T00:00:00.000Z",
  expiresAt: "2026-12-01T00:00:00.000Z",
  status: "active",
};
const intent = (over: Partial<PaymentIntent> = {}): PaymentIntent => ({
  id: "pi",
  payee: "vendor",
  payeeClass: "saas",
  amount: 80_00,
  currency: "GBP",
  rail: "card",
  rationale: "service payment",
  createdAt: NOW,
  ...over,
});
const ctx = (rep?: ReputationLevel): GateContext => ({
  now: NOW,
  mandates: [mandate],
  periodSpendByMandate: () => [],
  knownPayees: new Set(["vendor"]),
  reputationOf: rep ? () => rep : undefined,
  denyRules: DEFAULT_DENY_RULES,
  config: DEFAULT_GATE_CONFIG,
});

// --- C: network reputation ---
test("a flagged payee is riskier; a good-reputation payee is less risky", () => {
  const flagged = evaluateGate(intent(), ctx("flagged"));
  const good = evaluateGate(intent(), ctx("good"));
  assert.ok(flagged.risk.score > good.risk.score);
  assert.ok(flagged.risk.reasons.some((r) => r.includes("flagged")));
});

test("reputation never relaxes the floor (over-cap blocks even with good rep)", () => {
  const d = evaluateGate(intent({ amount: 600_00 }), ctx("good"));
  assert.equal(d.outcome, "block");
});

test("reputation is opt-in: no source leaves risk unchanged", () => {
  assert.equal(noReputation.reputation("x"), undefined);
  const d = evaluateGate(intent(), ctx(undefined));
  assert.ok(!d.risk.reasons.some((r) => r.includes("reputation")));
});

// --- B: service discovery + price evaluation ---
const offer = (over: Partial<ServiceOffer> = {}): ServiceOffer => ({
  service: "exa-search",
  payee: "exa",
  payeeClass: "saas",
  priceMinor: 5_00,
  currency: "GBP",
  rail: "card",
  ...over,
});

test("evaluateOffer accepts an affordable, covered offer", () => {
  const r = evaluateOffer(offer(), [mandate], NOW);
  assert.equal(r.affordable, true);
  assert.equal(r.coveringMandateId, "m");
});

test("evaluateOffer rejects an over-cap offer and an uncovered one", () => {
  assert.equal(evaluateOffer(offer({ priceMinor: 600_00 }), [mandate], NOW).affordable, false);
  assert.equal(evaluateOffer(offer({ payeeClass: "gambling" }), [mandate], NOW).affordable, false);
});

test("the catalog discovers offers, and an offer converts to a gateable intent", () => {
  const catalog = staticCatalog([offer(), offer({ service: "wolfram", payee: "wolfram" })]);
  assert.equal(catalog.list().length, 2);
  assert.equal(catalog.find("wolfram").length, 1);
  const i = offerToIntent(offer(), "pi_1", NOW);
  assert.equal(i.amount, 5_00);
  assert.equal(i.payee, "exa");
});

test("a reputation source maps payees to levels", () => {
  const src = staticReputationSource({ scam: "flagged", exa: "good" });
  assert.equal(src.reputation("scam"), "flagged");
  assert.equal(src.reputation("exa"), "good");
  assert.equal(src.reputation("unknown"), undefined);
});
