// The eval suite runner + regression detector. Ties the pieces together:
//   1. run each generated scenario live (deterministic executor + FakeRail),
//   2. assert the gate reached the EXPECTED outcome,
//   3. run the deterministic process checks over the signed trajectory,
//   4. aggregate pass^k (safety scenarios must hold on every run).
// The LLM-judge leg is separate (judge.ts) and opt-in.
//
// A scenario PASSES iff: the executor status equals `expect.status` AND there are
// no block-severity process violations. Both are deterministic, so this is a hard
// CI gate with no model and no flakiness.

import { generateScenarios, runScenario, type EvalScenario } from "./scenarios.ts";
import { checkTrajectory, type Violation } from "./process.ts";
import { computePassK, type PassKMode, type PassKResult } from "./passK.ts";

export interface ScenarioResult {
  scenarioId: string;
  derivedFrom: string;
  category: EvalScenario["category"];
  passed: boolean;
  /** the executor status we got vs what the spec expected */
  expectedStatus: string;
  actualStatus: string;
  outcomeOk: boolean;
  processOk: boolean;
  violations: Violation[];
  passK: PassKResult;
}

export interface EvalSuiteResult {
  total: number;
  passed: number;
  failed: number;
  /** true iff every scenario passed (the CI gate condition) */
  ok: boolean;
  results: ScenarioResult[];
}

export interface RunEvalOptions {
  scenarios?: EvalScenario[];
  /** runs per scenario for pass^k (default 1 — the gate path is deterministic, so
   *  k>1 matters once a real agent/model is in the loop). */
  k?: number;
  /** pass^k mode for SAFETY scenarios (default "all"). Execution scenarios use the
   *  same mode; safety is where "all" is non-negotiable. */
  mode?: PassKMode;
}

/** Run one scenario once: live execution → outcome check + process checks. */
async function runOnce(scenario: EvalScenario): Promise<{ ok: boolean; actualStatus: string; violations: Violation[] }> {
  const run = await runScenario(scenario);
  const outcomeOk = run.result.status === scenario.expect.status;
  const check = checkTrajectory(run.trajectory);
  return {
    ok: outcomeOk && check.ok,
    actualStatus: run.result.status,
    violations: check.violations,
  };
}

export async function runEvalSuite(opts: RunEvalOptions = {}): Promise<EvalSuiteResult> {
  const scenarios = opts.scenarios ?? generateScenarios();
  const k = opts.k ?? 1;
  const mode = opts.mode ?? "all";

  const results: ScenarioResult[] = [];
  for (const s of scenarios) {
    const runs: boolean[] = [];
    let lastStatus = "";
    let lastViolations: Violation[] = [];
    let outcomeOk = true;
    let processOk = true;
    for (let i = 0; i < k; i++) {
      const r = await runOnce(s);
      runs.push(r.ok);
      lastStatus = r.actualStatus;
      lastViolations = r.violations;
      if (r.actualStatus !== s.expect.status) outcomeOk = false;
      if (r.violations.some((v) => v.severity === "block")) processOk = false;
    }
    const passK = computePassK(s.id, runs, mode);
    results.push({
      scenarioId: s.id,
      derivedFrom: s.derivedFrom,
      category: s.category,
      passed: passK.passed,
      expectedStatus: s.expect.status,
      actualStatus: lastStatus,
      outcomeOk,
      processOk,
      violations: lastViolations,
      passK,
    });
  }

  const passed = results.filter((r) => r.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    ok: passed === results.length,
    results,
  };
}

// ── Regression detection (baseline vs candidate) ─────────────────────────────

export interface Regression {
  scenarioId: string;
  was: boolean;
  now: boolean;
}

export interface RegressionReport {
  hasBlockingRegression: boolean;
  regressions: Regression[];
  /** scenarios that went from failing → passing (improvements) */
  fixes: Regression[];
}

/** Compare two suite results: a regression is a scenario that passed in baseline
 *  and fails in candidate. Any such regression blocks (the CI gate). */
export function detectRegressions(
  baseline: EvalSuiteResult,
  candidate: EvalSuiteResult,
): RegressionReport {
  const byId = new Map(baseline.results.map((r) => [r.scenarioId, r.passed]));
  const regressions: Regression[] = [];
  const fixes: Regression[] = [];
  for (const r of candidate.results) {
    const was = byId.get(r.scenarioId);
    if (was === undefined) continue;
    if (was && !r.passed) regressions.push({ scenarioId: r.scenarioId, was, now: r.passed });
    if (!was && r.passed) fixes.push({ scenarioId: r.scenarioId, was, now: r.passed });
  }
  return { hasBlockingRegression: regressions.length > 0, regressions, fixes };
}
