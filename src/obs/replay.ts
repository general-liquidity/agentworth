// Audit replay — turn the signed, hash-linked audit chain into a human-readable
// timeline for inspection / dispute / forensics. Pairs with AuditLog.verify()
// (which re-checks the chain's integrity); this renders what happened, in order.

import type { AuditEntry } from "../core/audit.ts";

function summarize(payload: unknown): string {
  if (payload === null || typeof payload !== "object") return String(payload);
  const obj = payload as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of ["intentId", "outcome", "amount", "currency", "reason", "ok", "receiptId"]) {
    if (k in obj && obj[k] !== undefined) parts.push(`${k}=${String(obj[k])}`);
  }
  return parts.join(" ");
}

export function renderTimeline(entries: readonly AuditEntry[]): string[] {
  return entries.map((e) => `#${e.seq} ${e.ts} ${e.type} ${summarize(e.payload)}`.trimEnd());
}
