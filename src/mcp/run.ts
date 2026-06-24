// Reusable MCP entry point. Composes the sqlite-backed runtime and serves the MCP
// server over stdio, so BOTH the bundled `opensolvency mcp` CLI command and the
// standalone `@general-liquidity/opensolvency-mcp` package launch the exact same
// gated surface. Exposed as the package subpath `@general-liquidity/opensolvency/mcp`.

import { randomUUID } from "node:crypto";
import { AuditLog } from "../core/audit.ts";
import { createExecutor, type Executor } from "../core/executor.ts";
import { DEFAULT_GATE_CONFIG } from "../core/types.ts";
import { DEFAULT_DENY_RULES } from "../core/denyList.ts";
import { createSqliteStore } from "../store/sqliteStore.ts";
import { createRailRegistry } from "../rails/registry.ts";
import { createFakeRail } from "../rails/fakeRail.ts";
import { createOpenSolvencyMcpServer, startMcpStdio } from "./server.ts";
import type { Store } from "../core/store.ts";

export interface McpRuntime {
  store: Store;
  executor: Executor;
  audit: AuditLog;
  clock: () => string;
}

/** Build the persistent sqlite-backed runtime an MCP server needs. The DB path is
 *  `OPENSOLVENCY_DB` (default `opensolvency.db`) — point it at the operator's store
 *  so the server sees their real mandates. */
export function buildSqliteRuntime(
  dbPath = process.env.OPENSOLVENCY_DB ?? "opensolvency.db",
): McpRuntime {
  const store = createSqliteStore(dbPath);
  const audit = new AuditLog(store.operatorKey(), store.loadAudit());
  const rails = createRailRegistry([
    createFakeRail("card"),
    createFakeRail("checkout"),
    createFakeRail("onchain"),
  ]);
  const clock = () => new Date().toISOString();
  const executor = createExecutor({
    store, rails, audit, config: DEFAULT_GATE_CONFIG, denyRules: DEFAULT_DENY_RULES, clock,
  });
  return { store, executor, audit, clock };
}

/** Serve the OpenSolvency MCP surface over stdio. Pass an existing runtime (the
 *  CLI does, to reuse its open store) or omit it to build a fresh sqlite runtime
 *  (the standalone `-mcp` package). Exposes ONLY the safe surface: a gated `pay`
 *  plus read-only tools — operator controls are never exposed. */
export async function startOpenSolvencyMcp(runtime?: McpRuntime): Promise<void> {
  const { store, executor, audit, clock } = runtime ?? buildSqliteRuntime();
  const server = createOpenSolvencyMcpServer({
    executor, store, audit, clock, newId: () => `pi_${randomUUID().slice(0, 8)}`,
  });
  await startMcpStdio(server);
}
