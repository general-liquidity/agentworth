import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DENY_RULES, blocklistedPayeeRule } from "../src/core/denyList.ts";
import type { PaymentIntent } from "../src/core/types.ts";

const ZWSP = String.fromCodePoint(0x200b);
const CYR_A = String.fromCodePoint(0x0430);
const CYR_O = String.fromCodePoint(0x043e);

const matchCtx = { knownPayees: new Set<string>(), reversibility: "reversible" as const };
function intentTo(payee: string): PaymentIntent {
  return {
    id: "pi_1",
    payee,
    payeeClass: "misc",
    amount: 100_00,
    currency: "GBP",
    rail: "card",
    rationale: "test payment",
    createdAt: "2026-06-01T00:00:00Z",
  };
}

test("spoofed_payee_identifier blocks invisible-char payees by default", () => {
  const rule = DEFAULT_DENY_RULES.find((r) => r.id === "spoofed_payee_identifier");
  assert.ok(rule, "spoofed_payee_identifier should ship in DEFAULT_DENY_RULES");
  assert.equal(rule!.match(intentTo("ac" + ZWSP + "me"), matchCtx), true);
  assert.equal(rule!.match(intentTo("tesco"), matchCtx), false);
});

test("blocklistedPayeeRule blocks a sanctioned payee, case + homoglyph variants", () => {
  const rule = blocklistedPayeeRule(["BadActor", "0xDEADBEEF"]);
  assert.equal(rule.match(intentTo("BadActor"), matchCtx), true);
  assert.equal(rule.match(intentTo("badactor"), matchCtx), true); // case-fold
  assert.equal(rule.match(intentTo("0xdeadbeef"), matchCtx), true);
  // Cyrillic-spoofed "badactor" still caught via normalization
  assert.equal(rule.match(intentTo("b" + CYR_A + "dact" + CYR_O + "r"), matchCtx), true);
  // an unrelated payee passes
  assert.equal(rule.match(intentTo("goodpayee"), matchCtx), false);
});
