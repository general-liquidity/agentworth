// Operator-notification seam. When the gate routes a payment to operator
// confirmation (the `pending` outcome), the operator needs to know OUT OF BAND —
// they shouldn't have to poll `pending`. This is the push channel.
//
// Like every external edge in this system it's an INJECTED interface with a
// no-op default: the repo takes no hard dependency on email/Slack/Twilio. A
// console notifier is provided for local use, and a webhook notifier (dep-free,
// via an injected `fetch`) covers the common "POST to my endpoint" case. The
// signed audit log remains the record; this is a live operational signal only.
//
// IMPORTANT: notification is best-effort and MUST NOT affect the gate decision.
// A failing notifier can never turn a blocked payment into a settled one — the
// executor awaits nothing from it and swallows its errors.

import type { GateDecision, PaymentIntent } from "../core/types.ts";

/** Why the operator is being pinged. Only `approval_required` today, but typed as
 *  a union so halts / high-risk events can join without a breaking change. */
export type NotificationKind = "approval_required";

export interface Notification {
  kind: NotificationKind;
  intentId: string;
  /** minor-units + currency, for a glanceable "approve £X to <payee>?" message */
  amount: number;
  currency: string;
  payee: string;
  /** the gate's reasons the payment needs a human (e.g. "new payee", "over cap") */
  reasons: string[];
  /** ISO timestamp of the event */
  at: string;
}

export interface Notifier {
  /** Best-effort push. Never throws to the caller; never blocks settlement. */
  notify(n: Notification): Promise<void>;
}

/** Default: do nothing. Operators opt in to a real channel. */
export const noopNotifier: Notifier = {
  async notify() {},
};

/** Build a Notification from the executor's pending result. Pure helper so the
 *  executor wiring stays a one-liner and the shape is tested independently. */
export function approvalNotification(
  intent: PaymentIntent,
  decision: GateDecision,
  at: string,
): Notification {
  return {
    kind: "approval_required",
    intentId: intent.id,
    amount: intent.amount,
    currency: intent.currency,
    payee: intent.payee,
    reasons: decision.reasons,
    at,
  };
}

/** A human-readable one-line message — shared by the console + webhook channels
 *  so the wording is consistent. minor-units → plain amount (2-dp assumption). */
export function formatNotification(n: Notification): string {
  const amount = n.amount / 100;
  const amountStr = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return (
    `Approval needed: pay ${amountStr} ${n.currency} to ${n.payee} ` +
    `(${n.reasons.join("; ")}) — intent ${n.intentId}`
  );
}

/** Logs the approval request to stderr. For local/dev use. */
export function consoleNotifier(): Notifier {
  return {
    async notify(n) {
      console.error(`[notify] ${formatNotification(n)}`);
    },
  };
}

/** Minimal `fetch` surface this module needs — so we depend on the shape, not on
 *  any particular runtime's global. Operators pass Node's global `fetch`. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

export interface WebhookNotifierOptions {
  url: string;
  /** injected fetch (Node 18+ global, or a stub in tests) */
  fetch: FetchLike;
  /** optional bearer token sent as Authorization: Bearer <token> */
  token?: string;
}

/**
 * POSTs the notification as JSON to an operator endpoint (Slack/Discord/n8n/own
 * server). Best-effort: a non-OK response or a thrown fetch is swallowed and
 * logged to stderr — it can never block or alter a gate decision.
 */
export function webhookNotifier(opts: WebhookNotifierOptions): Notifier {
  return {
    async notify(n) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (opts.token) headers.authorization = `Bearer ${opts.token}`;
      try {
        const res = await opts.fetch(opts.url, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...n, message: formatNotification(n) }),
        });
        if (!res.ok) {
          console.error(`[notify] webhook returned ${res.status} for ${n.intentId}`);
        }
      } catch (err) {
        console.error(
          `[notify] webhook failed for ${n.intentId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}
