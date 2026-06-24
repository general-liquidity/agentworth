import test from "node:test";
import assert from "node:assert/strict";

import {
  generateAgentKeyPair,
  agentKeyFromPrivateHex,
  exportAgentKey,
  createChallenge,
  respondToChallenge,
  verifyChallengeResponse,
  loadOrCreateAgentKey,
} from "../src/disclosure/index.ts";
import { createMemoryStore } from "../src/store/memoryStore.ts";

const NOW = "2026-06-24T12:00:00.000Z";
const HEAD = "abc123";

test("a live challenge-response from the right key verifies", () => {
  const key = generateAgentKeyPair();
  const challenge = createChallenge(NOW, { nonce: "chal-1", verifierId: "verifier-A" });
  const response = respondToChallenge(challenge, key, HEAD, NOW);
  const r = verifyChallengeResponse(response, challenge, { expectedAgentId: key.publicKeyHex, now: NOW });
  assert.equal(r.ok, true, r.reason);
});

test("a response to a DIFFERENT challenge (replay) is rejected", () => {
  const key = generateAgentKeyPair();
  const issued = createChallenge(NOW, { nonce: "fresh" });
  const stolen = respondToChallenge(createChallenge(NOW, { nonce: "old" }), key, HEAD, NOW);
  const r = verifyChallengeResponse(stolen, issued, { expectedAgentId: key.publicKeyHex });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /nonce/);
});

test("a response signed by a key OTHER than the disclosed agent is rejected", () => {
  const agent = generateAgentKeyPair();
  const attacker = generateAgentKeyPair();
  const challenge = createChallenge(NOW, { nonce: "c" });
  // attacker answers, claiming the agent's identity by setting agentId? It can't:
  // the response carries the attacker's own pubkey, which won't match expectedAgentId.
  const response = respondToChallenge(challenge, attacker, HEAD, NOW);
  const r = verifyChallengeResponse(response, challenge, { expectedAgentId: agent.publicKeyHex });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /agentId/);
});

test("a forged signature (right agentId, wrong key) fails the crypto check", () => {
  const agent = generateAgentKeyPair();
  const attacker = generateAgentKeyPair();
  const challenge = createChallenge(NOW, { nonce: "c" });
  const response = respondToChallenge(challenge, attacker, HEAD, NOW);
  response.agentId = agent.publicKeyHex; // claim the agent's id, but signature is the attacker's
  const r = verifyChallengeResponse(response, challenge, { expectedAgentId: agent.publicKeyHex });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /signature/);
});

test("a stale response (older than maxAge) is rejected", () => {
  const key = generateAgentKeyPair();
  const challenge = createChallenge("2026-06-24T11:00:00.000Z", { nonce: "c" });
  const response = respondToChallenge(challenge, key, HEAD, "2026-06-24T11:00:00.000Z");
  const r = verifyChallengeResponse(response, challenge, {
    expectedAgentId: key.publicKeyHex, now: NOW, maxAgeMs: 60_000,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /stale/);
});

test("agent key persists across restarts (loadOrCreateAgentKey)", () => {
  const store = createMemoryStore("k");
  const a = loadOrCreateAgentKey(store);
  const b = loadOrCreateAgentKey(store); // second call reuses the persisted key
  assert.equal(a.publicKeyHex, b.publicKeyHex);
});

test("a key round-trips through export/import", () => {
  const key = generateAgentKeyPair();
  const restored = agentKeyFromPrivateHex(exportAgentKey(key));
  assert.equal(restored.publicKeyHex, key.publicKeyHex);
  // and the restored key produces a verifiable response
  const challenge = createChallenge(NOW, { nonce: "c" });
  const resp = respondToChallenge(challenge, restored, HEAD, NOW);
  assert.equal(verifyChallengeResponse(resp, challenge, { expectedAgentId: key.publicKeyHex, now: NOW }).ok, true);
});
