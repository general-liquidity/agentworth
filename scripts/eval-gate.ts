#!/usr/bin/env node
// CI eval gate. Runs the generated scenario suite live (deterministic executor +
// FakeRail), applies the process checks, and exits non-zero if ANY scenario fails
// its expected outcome or trips a block-severity process violation. No model, no
// network — a hard, deterministic gate, the analogue of Gordon's eval-gate.

import { runEvalSuite } from "../src/evals/index.ts";

async function main(): Promise<void> {
  const suite = await runEvalSuite({ k: 1, mode: "all" });

  for (const r of suite.results) {
    const mark = r.passed ? "✓" : "✗";
    const detail = r.passed
      ? `${r.actualStatus}`
      : `expected ${r.expectedStatus}, got ${r.actualStatus}` +
        (r.processOk ? "" : ` | ${r.violations.filter((v) => v.severity === "block").map((v) => v.rule).join(", ")}`);
    console.log(`${mark} ${r.scenarioId.padEnd(36)} [${r.derivedFrom}] ${detail}`);
  }
  console.log(`\n${suite.passed}/${suite.total} scenarios passed.`);

  if (!suite.ok) {
    console.error("\nEVAL GATE FAILED — a gate decision or process check regressed.");
    process.exit(1);
  }
  console.log("eval gate: PASS");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
