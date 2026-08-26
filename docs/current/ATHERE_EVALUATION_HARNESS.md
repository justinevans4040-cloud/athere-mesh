# Athere Evaluation and Regression Harness

**Status:** implemented core contract

The Phase 0 evaluation harness prevents architectural changes from being called improvements without repeated, pinned, comparative evidence.

## What it enforces

Every trial records:

- task success and false success;
- failed handoffs and state divergence;
- retries, recovery attempts, and recovery successes;
- token use, inference cost, and latency;
- agent, tool, and verifier calls;
- state mutations, plan deviations, and memory errors;
- results for every task in the regression set;
- exact system version, model provider/name/version, environment ID/version, determinism flag, and seed.

A cohort must contain at least two trials. Its suite, model, and environment are pinned across repetitions. A frozen control is immutable once written and is returned with the SHA-256 of its canonical bytes.

## Comparison rule

`compareEvaluationCohorts()` measures the control's observed noise floor and compares candidate rates and means against it. It returns only one of:

- `improvement_proven`: quality improves beyond noise, or efficiency improves beyond noise while quality and solved tasks remain intact;
- `no_proven_improvement`: observed movement does not clear the control noise floor;
- `regression`: quality falls outside noise or a previously solved task fails.

This verdict is deliberately conservative. Passing once or producing a faster anecdotal run is not proof of architectural improvement.

## Repository interface

- Production module: `packages/evaluation/src/evaluation-harness.js`
- Contract tests: `tests/contract/evaluation-harness.test.js`
- CLI: `pnpm evaluation:compare <frozen-control.json> <candidate.json>`
- Frozen-control writer: `writeFrozenEvaluation({ root, cohort })`

The CLI prints a machine-readable comparison report. It exits with code 2 for a regression so CI or a deployment gate can block advancement.

## Control-run policy

1. Define a versioned regression suite and deterministic environment where possible.
2. Collect at least two unchanged-system control trials.
3. Pin the system revision, model version, environment version, and seed for every trial.
4. Freeze the control with `writeFrozenEvaluation`; never overwrite it.
5. Run the candidate against the same suite and pinned conditions.
6. Use the comparison verdict and full metrics as the evidence attached to any improvement claim.
7. Add every newly solved task to future regression sets; do not delete failures to improve the score.

The harness does not invent unavailable telemetry. An executor or observer must supply measured trial records. Missing fields fail validation rather than being defaulted to zero.
