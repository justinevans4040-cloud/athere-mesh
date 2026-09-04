# Athere Gated Learning Pipeline (Item 21)

Gated Experience → Learning. **Agents cannot write experiences directly into permanent knowledge.**

## Pipeline

`EXPERIENCE` → `EXTRACT CANDIDATE LESSON` → `VERIFY` → `TEST` → `COMPARE AGAINST CONTROL` → `APPROVE` → `STORE` → `REUSE` → `MEASURE`

Learning must pass QR18-style layer verification before approve/store.

## Acceptance

Athere can demonstrate that retained learning improves future performance without introducing unacceptable regressions (`measure()` / `runLearningPipeline()`).

## API

- `packages/contracts/src/learning-pipeline.js` — stages, normalizers, compare metrics, QR18-style evaluate, approver gate
- `packages/learning/src/gated-learning-pipeline.js` — `createGatedLearningPipeline()`
- `service.runLearningPipeline(...)`
- `service.storeLearningPermanent(...)` — always rejected (direct write forbidden)
- `service.listPermanentLearning()`

Approvers: `qra_emerge_audit`, `miss-vale-prime` only (executors cannot approve).

## Security (local)

- Stage skips rejected
- Regression / non-improvement vs control rejected before approve
- Direct permanent write rejected
- `learnedKnowledge` via generic `transition` rejected
- No new HTTP surface
- Mission revision unchanged by advisory learning store (separate pipeline store)

## Evidence

- `tests/contract/learning-pipeline.test.js`
- `tests/integration/learning-pipeline-item21.test.js`
