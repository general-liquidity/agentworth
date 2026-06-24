// ACP stdio transport. Reads newline-delimited JSON-RPC messages from stdin,
// dispatches each through the pure `handleAcpMessage`, and writes responses +
// notifications to stdout. This is the thin I/O shell; all logic is in protocol.ts.
//
// `runPrompt` is injected by the caller (the CLI `acp` command composes the real
// gate-enforced finance agent). Kept dependency-light: line-delimited JSON over
// stdio, no transport library.

import { createInterface } from "node:readline";
import { handleAcpMessage, type AcpDeps, type JsonRpcRequest } from "./protocol.ts";

export function runAcpStdio(deps: AcpDeps): void {
  const rl = createInterface({ input: process.stdin });
  const write = (obj: unknown) => process.stdout.write(`${JSON.stringify(obj)}\n`);

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: JsonRpcRequest;
    try {
      msg = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      return;
    }
    void handleAcpMessage(msg, deps).then((out) => {
      for (const n of out.notifications ?? []) write(n);
      if (out.response) write(out.response);
    });
  });
}
