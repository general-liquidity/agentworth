import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mapWorldIdToAttestation,
  validateWorldIdStructural,
  verifyWorldId,
  worldIdIdentityVerifier,
  type WorldIdAttestation,
} from "../src/identity/worldId.ts";

function proof(over: Partial<WorldIdAttestation> = {}): WorldIdAttestation {
  return {
    scheme: "WorldID",
    app_id: "app_staging_abc123",
    action: "verify-human",
    nullifier_hash: "0xabc123",
    merkle_root: "0xdef456",
    proof: "0x0011223344",
    verification_level: "orb",
    ...over,
  };
}

test("validateWorldIdStructural accepts a well-formed proof", () => {
  assert.equal(validateWorldIdStructural(proof()), true);
  assert.equal(validateWorldIdStructural(proof({ signal: "0xfeed" })), true);
  assert.equal(validateWorldIdStructural(proof({ verification_level: "device" })), true);
});

test("validateWorldIdStructural rejects malformed proofs", () => {
  assert.equal(validateWorldIdStructural(proof({ app_id: "abc123" })), false); // no app_ prefix
  assert.equal(validateWorldIdStructural(proof({ action: "" })), false); // empty action
  assert.equal(validateWorldIdStructural(proof({ nullifier_hash: "abc" })), false); // not hex
  assert.equal(validateWorldIdStructural(proof({ merkle_root: "0xZZ" })), false); // bad hex
  assert.equal(
    validateWorldIdStructural(proof({ verification_level: "passport" as never })),
    false,
  ); // level not in the 4
  assert.equal(validateWorldIdStructural({ scheme: "Other" } as never), false);
});

test("mapWorldIdToAttestation: invalid → none; orb → registry_attested; else → signed", () => {
  assert.equal(mapWorldIdToAttestation("orb", false), "none");
  assert.equal(mapWorldIdToAttestation("device", false), "none");
  assert.equal(mapWorldIdToAttestation("orb", true), "registry_attested");
  assert.equal(mapWorldIdToAttestation("device", true), "signed");
  assert.equal(mapWorldIdToAttestation("document", true), "signed");
  assert.equal(mapWorldIdToAttestation("secure_document", true), "signed");
});

test("verifyWorldId: no verifier → structural-only (valid:false), never throws", async () => {
  const res = await verifyWorldId(proof());
  assert.equal(res.structural, true);
  assert.equal(res.valid, false);
  assert.equal(res.nullifier, "0xabc123");
  assert.ok(res.reason?.includes("no World ID verifier"));
});

test("verifyWorldId: malformed proof → structural false, valid false", async () => {
  const res = await verifyWorldId(proof({ app_id: "nope" }), {
    verifier: async () => ({ valid: true }),
  });
  assert.equal(res.structural, false);
  assert.equal(res.valid, false);
});

test("verifyWorldId: injected verifier valid:true → valid + canonical nullifier", async () => {
  const res = await verifyWorldId(proof(), {
    verifier: async (a) => {
      assert.equal(a.app_id, "app_staging_abc123");
      return { valid: true, nullifier: "0xcanonical" };
    },
  });
  assert.equal(res.valid, true);
  assert.equal(res.nullifier, "0xcanonical");
  assert.equal(res.reason, undefined);
});

test("verifyWorldId: injected verifier rejects → valid:false with reason", async () => {
  const res = await verifyWorldId(proof(), { verifier: async () => ({ valid: false }) });
  assert.equal(res.valid, false);
  assert.ok(res.reason?.includes("rejected"));
});

test("worldIdIdentityVerifier: orb + valid → registry_attested, agentId = nullifier", async () => {
  const v = worldIdIdentityVerifier({ verifier: async () => ({ valid: true }) });
  const res = await v.verify(proof({ verification_level: "orb" }));
  assert.equal(res.verified, true);
  assert.equal(res.identity.attestation, "registry_attested");
  assert.equal(res.identity.agentId, "0xabc123");
});

test("worldIdIdentityVerifier: device + valid → signed", async () => {
  const v = worldIdIdentityVerifier({ verifier: async () => ({ valid: true }) });
  const res = await v.verify(proof({ verification_level: "device" }));
  assert.equal(res.verified, true);
  assert.equal(res.identity.attestation, "signed");
});

test("worldIdIdentityVerifier: invalid proof → none, not verified", async () => {
  const v = worldIdIdentityVerifier({ verifier: async () => ({ valid: false }) });
  const res = await v.verify(proof());
  assert.equal(res.verified, false);
  assert.equal(res.identity.attestation, "none");
});

test("worldIdIdentityVerifier: no verifier → structural-only, attestation none", async () => {
  const v = worldIdIdentityVerifier();
  const res = await v.verify(proof());
  assert.equal(res.verified, false);
  assert.equal(res.identity.attestation, "none");
  assert.equal(res.identity.agentId, "0xabc123");
});

test("worldIdIdentityVerifier: non-World-ID artifact → unverified none", async () => {
  const v = worldIdIdentityVerifier({ verifier: async () => ({ valid: true }) });
  const res = await v.verify({ nope: true });
  assert.equal(res.verified, false);
  assert.equal(res.identity.attestation, "none");
  assert.ok(res.reasons.some((r) => r.includes("not a World ID")));
});
