// The OpenSolvency-specific half: populate a vendor-neutral AgentDisclosure from
// the LIVE governance primitives. This is the part that does NOT lift into the
// standalone `verifiable-agency` repo - it IS the reference implementation that
// makes OpenSolvency a credible counterparty. Every field is derived from
// something real (the enforced gate, the granted mandates, the signed audit
// chain, a SpendTrust run), not asserted.

import { DEFAULT_DENY_RULES } from "../core/denyList.ts";
import { DEFAULT_GATE_CONFIG } from "../core/types.ts";
import type { Store } from "../core/store.ts";
import type { AuditLog } from "../core/audit.ts";
import type { TrustScore } from "../benchmark/spendTrust.ts";
import {
  sha256Hex,
  canonicalize,
  signDisclosure,
  generateAgentKeyPair,
  exportAgentKey,
  agentKeyFromPrivateHex,
  type AgentKeyPair,
} from "./attestation.ts";
import type {
  AgentDisclosure,
  Constitution,
  HardConstraint,
  ToolInventory,
  CapitalEnvelope,
  DeploymentHistory,
  RedTeamAttestation,
  SignedDisclosure,
} from "./schema.ts";
import { DISCLOSURE_SCHEMA_VERSION } from "./schema.ts";

const GENESIS = "0".repeat(64);
const DEFAULT_VALIDITY_MS = 60 * 60 * 1000; // 1 hour

// The canonical OpenSolvency tool surface + its permission boundary: one gated
// money path, read-only introspection, operator-only controls the agent can't reach.
const DEFAULT_TOOL_INVENTORY: ToolInventory = {
  valuePath: "executor",
  tools: [
    { name: "pay", access: "gated", movesValue: true },
    { name: "list_mandates", access: "read_only", movesValue: false },
    { name: "pending", access: "read_only", movesValue: false },
    { name: "status", access: "read_only", movesValue: false },
    { name: "audit_verify", access: "read_only", movesValue: false },
    { name: "approve", access: "operator_only", movesValue: false },
    { name: "kill_switch", access: "operator_only", movesValue: false },
    { name: "refund", access: "operator_only", movesValue: false },
  ],
};

export interface BuildDisclosureDeps {
  store: Store;
  audit: AuditLog;
  /** the agent's signing identity - its public key is the agentId */
  agentKey: AgentKeyPair;
  /** the composed system prompt to fingerprint */
  systemPrompt: string;
  operator: {
    id: string;
    deniabilityBoundary: string;
    attestation?: { scheme: "AIP" | "VisaTAP" | "ERC8004" | "none"; level: "none" | "signed" | "registry_attested"; evidence?: string };
  };
  now: string;
  nonce: string;
  /** disclosure validity window (default 1h) */
  validityMs?: number;
  /** override the declared tool surface (default = the canonical OpenSolvency one) */
  toolInventory?: ToolInventory;
  /** a SpendTrust run to attest to (the red-team field) */
  spendTrust?: { corpus: { name: string; version: string }; result: TrustScore };
}

function buildConstitution(): Constitution {
  const hardConstraints: HardConstraint[] = DEFAULT_DENY_RULES.map((r) => ({
    id: r.id,
    description: r.reason,
    kind: "deny" as const,
  }));
  const parameters = {
    minRationaleChars: DEFAULT_GATE_CONFIG.minRationaleChars,
    velocityWindowMinutes: DEFAULT_GATE_CONFIG.velocityWindowMinutes,
    velocityMaxCount: DEFAULT_GATE_CONFIG.velocityMaxCount,
    anomalyMultiple: DEFAULT_GATE_CONFIG.anomalyMultiple,
  };
  return {
    hardConstraints,
    parameters,
    digest: sha256Hex(canonicalize({ hardConstraints, parameters })),
    // OpenSolvency ENFORCES these: the gate is a pure function the agent cannot
    // override. This is the field that separates a disclosure from a promise.
    enforced: true,
    enforcementEvidence: "opensolvency-gate (evaluateGate over structured intent)",
  };
}

function buildCapital(store: Store): CapitalEnvelope {
  const mandates = store.listMandates().map((m) => ({
    label: m.label,
    scope: m.scope.kind === "class" ? `class:${m.scope.value}` : `allowlist:${m.scope.values.length}`,
    currency: m.currency,
    perTxCapMinor: m.perTxCap,
    perPeriodCapMinor: m.perPeriodCap,
    period: m.period,
    allowedRails: [...m.allowedRails],
    expiresAt: m.expiresAt,
  }));
  return { mandates, custody: "non_custodial" };
}

function buildHistory(audit: AuditLog): DeploymentHistory {
  const entries = audit.entries();
  const head = entries.length ? entries[entries.length - 1].hash : GENESIS;
  let totalDecisions = 0;
  let settledCount = 0;
  let blockedCount = 0;
  for (const e of entries) {
    if (e.type === "gate.decision") {
      totalDecisions++;
      const outcome = (e.payload as { outcome?: string } | undefined)?.outcome;
      if (outcome === "block") blockedCount++;
    } else if (e.type === "payment.settled") {
      settledCount++;
    }
  }
  return {
    chainAnchor: head,
    summary: {
      totalDecisions,
      settledCount,
      blockedCount,
      firstSeen: entries[0]?.ts,
      lastActive: entries[entries.length - 1]?.ts,
    },
    verificationHint: "verify the exported chain with verifyAuditExport(dump, operatorKey)",
  };
}

function buildRedTeam(
  input: NonNullable<BuildDisclosureDeps["spendTrust"]>,
  now: string,
): RedTeamAttestation {
  const r = input.result;
  return {
    corpus: input.corpus,
    result: {
      grade: r.grade,
      score: r.score,
      passed: !r.hardFail,
      hardFails: r.hardFail ? r.violations : [],
    },
    attestedAt: now,
  };
}

/** Build the disclosure document from the live OpenSolvency runtime. */
export function buildAgentDisclosure(deps: BuildDisclosureDeps): AgentDisclosure {
  const agentId = deps.agentKey.publicKeyHex;
  const validUntil = new Date(Date.parse(deps.now) + (deps.validityMs ?? DEFAULT_VALIDITY_MS)).toISOString();
  const history = buildHistory(deps.audit);
  return {
    version: DISCLOSURE_SCHEMA_VERSION,
    disclosureId: `disc_${sha256Hex(agentId + deps.nonce + deps.now).slice(0, 16)}`,
    agentId,
    issuedAt: deps.now,
    validUntil,
    nonce: deps.nonce,
    auditAnchor: history.chainAnchor,
    systemPrompt: { algorithm: "sha256", digest: sha256Hex(deps.systemPrompt) },
    constitution: buildConstitution(),
    tools: deps.toolInventory ?? DEFAULT_TOOL_INVENTORY,
    capital: buildCapital(deps.store),
    operator: {
      operatorId: deps.operator.id,
      attestation: deps.operator.attestation ?? { scheme: "none", level: "none" },
      deniabilityBoundary: deps.operator.deniabilityBoundary,
    },
    history,
    redTeam: deps.spendTrust ? buildRedTeam(deps.spendTrust, deps.now) : undefined,
  };
}

/** Build + sign in one call - the end-to-end "emit a verifiable disclosure" path. */
export function buildAndSignDisclosure(deps: BuildDisclosureDeps): SignedDisclosure {
  return signDisclosure(buildAgentDisclosure(deps), deps.agentKey);
}

const DISCLOSURE_KEY_META = "disclosure_key";

/** Load the agent's stable signing identity from the store, minting + persisting one
 *  on first use. The private key lives in operator-only meta (never an agent tool),
 *  so the agentId is the same across restarts - which is what makes a counterparty's
 *  reputation of the agent meaningful over time. */
export function loadOrCreateAgentKey(store: Store): AgentKeyPair {
  const stored = store.getMeta(DISCLOSURE_KEY_META);
  if (stored) return agentKeyFromPrivateHex(stored);
  const key = generateAgentKeyPair();
  store.setMeta(DISCLOSURE_KEY_META, exportAgentKey(key));
  return key;
}
