import test from "node:test";
import assert from "node:assert/strict";

import { handleAcpMessage, type AcpDeps, type JsonRpcRequest } from "../src/acp/protocol.ts";

function deps(over: Partial<AcpDeps> = {}): AcpDeps {
  let n = 0;
  return {
    runPrompt: async (_sid, text) => `echo: ${text}`,
    newSessionId: () => `sess_${n++}`,
    ...over,
  };
}

test("initialize advertises the protocol version and no auth methods", async () => {
  const out = await handleAcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize" }, deps());
  assert.equal((out.response?.result as any).protocolVersion, 1);
  assert.deepEqual((out.response?.result as any).authMethods, []);
});

test("session/new returns a fresh session id", async () => {
  const out = await handleAcpMessage({ jsonrpc: "2.0", id: 2, method: "session/new" }, deps());
  assert.equal((out.response?.result as any).sessionId, "sess_0");
});

test("session/prompt routes text through the agent and streams + closes the turn", async () => {
  const seen: string[] = [];
  const msg: JsonRpcRequest = {
    jsonrpc: "2.0",
    id: 3,
    method: "session/prompt",
    params: { sessionId: "sess_0", prompt: [{ type: "text", text: "save " }, { type: "text", text: "£50" }] },
  };
  const out = await handleAcpMessage(msg, deps({ runPrompt: async (_s, t) => { seen.push(t); return `did: ${t}`; } }));
  // the agent saw the concatenated prompt text
  assert.equal(seen[0], "save £50");
  // a streaming update notification carries the reply...
  const update = out.notifications?.[0];
  assert.equal(update?.method, "session/update");
  assert.equal((update?.params as any).update.content.text, "did: save £50");
  // ...and the response closes the turn
  assert.equal((out.response?.result as any).stopReason, "end_turn");
});

test("session/prompt without a sessionId is an invalid-params error", async () => {
  const out = await handleAcpMessage(
    { jsonrpc: "2.0", id: 4, method: "session/prompt", params: { prompt: [{ type: "text", text: "x" }] } },
    deps(),
  );
  assert.equal(out.response?.error?.code, -32602);
});

test("an unknown request method returns method-not-found; an unknown notification is ignored", async () => {
  const req = await handleAcpMessage({ jsonrpc: "2.0", id: 5, method: "frobnicate" }, deps());
  assert.equal(req.response?.error?.code, -32601);
  const note = await handleAcpMessage({ jsonrpc: "2.0", method: "some/notification" } as JsonRpcRequest, deps());
  assert.deepEqual(note, {});
});
