# Athere Evaluation and Regression Harness

**Status:** core contract implemented; permanent measured control not yet recorded

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

A cohort must contain at least two trials. Its suite, system version, model, environment, and regression task set are pinned across repetitions. A frozen control is immutable once written and is returned with the SHA-256 of its canonical bytes.

## Comparison rule

`compareEvaluationCohorts()` measures the control's observed noise floor and compares candidate rates and means against it. It returns only one of:

- `improvement_proven`: quality improves beyond noise, or efficiency improves beyond noise while quality and solved tasks remain intact;
- `no_proven_improvement`: observed movement does not clear the control noise floor;
- `regression`: quality falls outside noise or a previously solved task fails.

This verdict is deliberately conservative. Passing once or producing a faster anecdotal run is not proof of architectural improvement.

Control and candidate cohorts must use the same suite, regression task set, and canonically equivalent model and environment definitions. The candidate system version may differ because that is the architecture under evaluation; task, model, or environment drift is rejected rather than misreported as a system improvement.

## Repository interface

- Production module: `packages/evaluation/src/evaluation-harness.js`
- Contract tests: `tests/contract/evaluation-harness.test.js` and `tests/contract/evaluation-pinning.test.js`
- CLI: `pnpm evaluation:compare <frozen-control.json> <candidate.json>`
- Frozen-control writer: `writeFrozenEvaluation({ root, cohort })`

The CLI prints a machine-readable comparison report. It exits with code 2 for a regression so an external deployment gate can block advancement.

## Control-run policy

1. Define a versioned regression suite and deterministic environment where possible.
2. Collect at least two unchanged-system control trials from the declared production-compatible runtime.
3. Pin the system revision, model definition, environment definition, and seed for every repeated trial.
4. Freeze the measured control with `writeFrozenEvaluation`; never overwrite it.
5. Run the candidate against the same suite, model definition, and environment definition.
6. Use the comparison verdict and full metrics as the evidence attached to any improvement claim.
7. Add every newly solved task to future regression sets; do not delete failures to improve the score.

The harness does not invent unavailable telemetry. An executor or observer must supply measured trial records. Missing fields fail validation rather than being defaulted to zero.

## Current evidence boundary

The repository does not currently contain a persisted `evaluations/controls/` control artifact. Until repeated measured control trials are executed and frozen on a production-compatible Node >=24 environment, Item 2 remains partially complete and later architectural work must not be described as benchmark-proven improvement merely because its functional tests pass.
