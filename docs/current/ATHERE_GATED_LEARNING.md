# Athere Gated Learning Pipeline (Item 21)

Gated Experience → Learning. **Agents cannot write experiences directly into permanent knowledge.**

## Pipeline

`EXPERIENCE` → `EXTRACT CANDIDATE LESSON` → `VERIFY` → `TEST` → `COMPARE AGAINST CONTROL` → `APPROVE` → `STORE` → `REUSE` → `MEASURE`

Learning must pass QR18-style layer verification before approve/store.

## Acceptance

Athere can demonstrate that retained learning improves future performance without introducing unacceptable regressions (`measure()` / `runLearningPipeline()`).

Compare and measure are **Item 2 harness-backed**: caller-supplied `{ taskSuccessRate, failedHandoffs }` metrics are rejected. `compareAgainstControl` loads the frozen `titan-core-v2` control and requires `compareEvaluationCohorts` verdict `improvement_proven`. `measure()` fails closed without that harness verdict.

## API

- `packages/contracts/src/learning-pipeline.js` — stages, normalizers, QR18-style evaluate, approver gate
- `packages/learning/src/gated-learning-pipeline.js` — `createGatedLearningPipeline({ repositoryRoot })`
- `service.runLearningPipeline({ ..., candidateCohort? })` — omits cohort → builds efficiency candidate from frozen control
- `service.storeLearningPermanent(...)` — always rejected (direct write forbidden)
- `service.listPermanentLearning()`

Approvers: `qra_emerge_audit`, `miss-vale-prime` only (executors cannot approve).

## Security (local)

- Stage skips rejected
- Caller-supplied control/candidate metrics rejected
- Regression / non-improvement vs frozen harness control rejected before approve
- Direct permanent write rejected
- Revoked identities cannot submit experiences or approve
- Unbranded injectable learning pipelines rejected (WeakSet factory brand)
- Permanent `store()` requires the approver identity still active
- `learnedKnowledge` via generic `transition` rejected
- No new HTTP surface
- Mission revision unchanged by advisory learning store (separate pipeline store)

## Evidence

- `tests/contract/learning-pipeline.test.js`
- `tests/contract/evaluation-frozen-control.test.js`
- `tests/integration/learning-pipeline-item21.test.js`
