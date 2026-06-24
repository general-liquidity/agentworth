import test from "node:test";
import assert from "node:assert/strict";

import {
  LEVER_EVIDENCE,
  rankLeversByEvidence,
  evidenceFor,
  choiceArchitectureGuidance,
} from "../src/finance/choiceArchitecture.ts";

test("the one robust lever is the default-changing (act) one, and it ranks first", () => {
  const ranked = rankLeversByEvidence();
  assert.equal(ranked[0].leverId, "act_on_default");
  assert.equal(ranked[0].category, "structure");
  assert.equal(ranked[0].strength, "robust");
  // It is the ONLY robust lever — the corrected evidence concentrates there.
  const robust = LEVER_EVIDENCE.filter((l) => l.strength === "robust");
  assert.equal(robust.length, 1);
  assert.equal(robust[0].leverId, "act_on_default");
});

test("the peer nudge is classified as decision-information and contested", () => {
  const peer = evidenceFor("peer_nudge");
  assert.ok(peer);
  assert.equal(peer.category, "information");
  // After publication-bias correction the information category is evidence-against.
  assert.equal(peer.strength, "contested");
});

test("no information/assistance lever is ranked above the robust structure lever", () => {
  const ranked = rankLeversByEvidence();
  const firstNonStructure = ranked.findIndex((l) => l.category !== "structure");
  const lastStructure = ranked.map((l) => l.category).lastIndexOf("structure");
  // every structure lever precedes the first non-structure lever
  assert.ok(lastStructure < firstNonStructure);
});

test("ranking is deterministic (stable by id within equal strength)", () => {
  const a = rankLeversByEvidence().map((l) => l.leverId);
  const b = rankLeversByEvidence().map((l) => l.leverId);
  assert.deepEqual(a, b);
});

test("guidance encodes prefer-default-over-nudge and demotes information levers", () => {
  const lines = choiceArchitectureGuidance();
  assert.ok(lines.length >= 2);
  const joined = lines.join(" ").toLowerCase();
  assert.match(joined, /default/);
  assert.match(joined, /publication bias/);
  assert.match(joined, /low-confidence|never rely|mechanism is/);
});

test("evidenceFor returns undefined for an unknown lever", () => {
  assert.equal(evidenceFor("not_a_lever"), undefined);
});
