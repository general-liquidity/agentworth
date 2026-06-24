# @general-liquidity/opensolvency-mcp

The [OpenSolvency](https://github.com/general-liquidity/opensolvency) governance
gate as an [MCP](https://modelcontextprotocol.io) server. An agent (Claude Code,
Cursor, …) gets a single money-moving tool — `pay` — that is evaluated by the
operator's mandates, caps, risk, and deny-list before anything settles, plus
read-only tools for mandates, pending intents, status, and audit verification.

**The security boundary is the point:** operator controls (approve / kill switch /
refund / amend) are deliberately *not* exposed — an external agent can never
approve its own payment or disarm the kill switch.

## Use

Add to your MCP client config:

```json
{
  "mcpServers": {
    "opensolvency": {
      "command": "npx",
      "args": ["-y", "@general-liquidity/opensolvency-mcp"],
      "env": { "OPENSOLVENCY_DB": "/path/to/your/opensolvency.db" }
    }
  }
}
```

`OPENSOLVENCY_DB` should point at the operator's persistent store (the same DB the
`opensolvency` CLI uses) so the server sees their real mandates. Requires Node ≥ 22.18.

## Tools

| Tool | Access |
|---|---|
| `pay` | Propose a payment — **runs through the gate**, cannot bypass it |
| `list_mandates`, `pending`, `status`, `audit_verify` | Read-only |

MIT © General Liquidity.
