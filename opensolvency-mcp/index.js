#!/usr/bin/env node
// @general-liquidity/opensolvency-mcp — the OpenSolvency MCP server as a standalone
// npx-able package. Delegates to the main package's MCP entry; all logic lives
// there. Point OPENSOLVENCY_DB at the operator's store so the server sees their
// real mandates.
import { startOpenSolvencyMcp } from "@general-liquidity/opensolvency/mcp";

startOpenSolvencyMcp().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
