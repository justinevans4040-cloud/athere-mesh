# Athere Executive Controller (Item 16)

Advisory executive decisions from **authoritative mission state** only. Does not mutate missions, certify success, or bypass MEA / workflow path gates.

## API

- `decideNext({ mission, actor?, budget? })`
- `assertExecutivePreservesIntegrity(decision, mission)`
- `assertExecutiveActor(actor)`
- `service.decideNext({ missionId, actor?, budget? })`

## Closed actors

`mission-state-service` | `orchestrator` | `miss-vale-prime`

## Decisions

| Action | When |
| --- | --- |
| `allocate_work` | next pending plan step with enough info |
| `verify` | auditor path / verify-proof |
| `research` | insufficient information |
| `retry` / `change_strategy` | failed/blocked — recovery driver + checkpoint/branch ops |
| `stop` | completed |
| `escalate_human` | blocked with no checkpoint / no work |

## Acceptance

Athere can dynamically change strategy (quarantine/retry/branch recommendations) while preserving mission integrity: no self-certify, no direct mutation, no path skip, strategy changes only via `qra_recovery_driver`.

The mission orchestrator **consults** `decideNext({ actor: 'orchestrator' })` after a failure block. When the decision is `change_strategy` / `retry` with `retry_from_checkpoint`, it applies heal through the recovery coordinator. When the decision is `escalate_human` (e.g. blocked with no checkpoint), the mission stays blocked. Executive decisions never certify success.

## Security (local hostile audit)

- No HTTP route for executive decisions
- MEA untouched — executive cannot advance `completedWork` or emit `completed`
- Unauthorized executive actors fail closed
- `canCertifySuccess` always false; `mutatesMission` always false
- Off-plan `pendingWork` cannot be allocated; path-skip still rejected
- Orchestrator applies only integrity-preserving recovery strategies from `decideNext`

## Evidence

- `packages/executive/src/executive-controller.js`
- `packages/orchestrator/src/mission-orchestrator.js` (`blockThenHeal`)
- `tests/contract/executive-controller.test.js`
- `tests/integration/executive-controller-item16.test.js`
- `tests/integration/executive-orchestrator-item16.test.js`
