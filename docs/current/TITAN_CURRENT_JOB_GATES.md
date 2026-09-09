# Titan current-job gates — where this lives

**As of:** 2026-09-09 (Lenovo)  
**LIVE home:** `justinevans4040-cloud/athere-mesh` on `master`  
**Do not look first:** chat summaries, `wakeforged` nested copies, superseded handoffs.

## What it is

One current-job pointer beside mission authority, with admission/exit gates and QR18 step-ladder audit loop. Crash/stop **tie-in** checkpoints are **continuity only** — not retry checkpoints.

## Findable code (athere-mesh)

| Piece | Path |
|---|---|
| Pointer + tie-in helpers | `packages/mission/src/current-job-pointer.js` |
| Admit / lookback / writeTieIn | `packages/mission/src/mission-state-service.js` |
| Filesystem CAS | `packages/mission/src/mission-store.js` |
| Postgres CAS | `packages/postgres/src/postgres-mission-store.js` (+ state store) |
| Orchestrator bind / getCurrentJob | `packages/orchestrator/src/mission-orchestrator.js` |
| QR18 ladder loop | `packages/proof/src/step-ladder-audit-loop.js` |
| Executive continuity | `packages/executive/src/executive-controller.js` |
| Recovery continuity | `packages/recovery/src/recovery-coordinator.js` |
| API surface | `packages/api/src/titan-api.js` |
| Focused tests | `tests/integration/current-job-pointer-gates.test.js`, `tests/integration/postgres-current-job-pointer.test.js`, `tests/contract/step-ladder-audit-loop.test.js`, `tests/contract/executive-controller.test.js` |

## Provenance (wrong-home parking — ARCHIVE pointer only)

Cloud agent could not push to `athere-mesh` (403). Work was temporarily pushed to:

- Repo: `justinevans4040-cloud/wakeforged`
- Branch: `cursor/titan-current-job-gates-197c`
- Tips: `35254bb` (feature) → `55b7994` (harden)
- Portable format-patch kept here: `docs/current/titan-current-job-gates.patch`

**That wakeforged branch is not the live product.** After 2026-09-09 land, treat `athere-mesh` `master` as authoritative.

## Prove it

```bash
node --test tests/integration/current-job-pointer-gates.test.js tests/contract/executive-controller.test.js tests/contract/step-ladder-audit-loop.test.js tests/integration/postgres-current-job-pointer.test.js
```
