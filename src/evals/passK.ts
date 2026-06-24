// pass^k — the Sierra τ²-bench reliability metric (Gordon's pattern). A money
// agent that's safe "on average" is not safe; a safety scenario must hold on
// EVERY run. `computePassK` aggregates k boolean run-results per scenario.
//
//   mode "all"  → passes only if all k runs passed (safety: no luck allowed).
//   mode "any"  → passes if any run passed (capability ceiling).
//   mode "frac" → reports the pass fraction (diagnostic, not a gate).

export type PassKMode = "all" | "any" | "frac";

export interface PassKResult {
  scenarioId: string;
  k: number;
  passes: number;
  /** gate result under the chosen mode */
  passed: boolean;
  fraction: number;
}

export function computePassK(
  scenarioId: string,
  runResults: readonly boolean[],
  mode: PassKMode = "all",
): PassKResult {
  const k = runResults.length;
  const passes = runResults.filter(Boolean).length;
  const fraction = k === 0 ? 0 : passes / k;
  const passed =
    mode === "all" ? passes === k && k > 0 : mode === "any" ? passes > 0 : fraction >= 0.5;
  return { scenarioId, k, passes, passed, fraction };
}
