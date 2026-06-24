// The portable pure-gate kernel — the crown-jewel invariant with ZERO `node:*`
// dependencies, so the SAME decision logic runs anywhere JS does: a browser, a
// Cloudflare/Deno edge worker, another agent's process, an embedded host. No
// rewrite, no second implementation to drift out of sync (the deliberate choice
// over a WASM port: one source of truth for the safety claim).
//
// This is the *decision* surface only — `evaluateGate` plus its pure inputs
// (mandate/risk/deny-list/trust/reputation/fx + types). The executor, store, audit,
// and rails (which DO touch Node) are not here; embed this to decide, call back to
// a host to actually move money.
//
// Verified node-free by `test/portable.test.ts` (asserts the emitted bundle imports
// no `node:` builtin).

export { evaluateGate, isLiveMandate } from "./core/gate.ts";
export { classifySpendRisk } from "./core/risk.ts";
export { DEFAULT_DENY_RULES } from "./core/denyList.ts";
export { payeeTrust } from "./core/trust.ts";
export { convertMinor } from "./core/fx.ts";
export { staticReputationSource, noReputation } from "./core/reputation.ts";
export { RAIL_REVERSIBILITY, DEFAULT_GATE_CONFIG } from "./core/types.ts";

export type {
  Mandate,
  MandateStatus,
  PaymentIntent,
  PayeeScope,
  Period,
  RailKind,
  Reversibility,
  GateConfig,
  GateContext,
  GateDecision,
  GateOutcome,
  DenyRule,
  SpendRisk,
  SpendRiskTier,
  PriorSpend,
  Attestation,
  ReputationLevel,
} from "./core/types.ts";
export type { TrustLevel } from "./core/trust.ts";
export type { ReputationSource } from "./core/reputation.ts";
export type { FxRateSource } from "./core/fx.ts";
