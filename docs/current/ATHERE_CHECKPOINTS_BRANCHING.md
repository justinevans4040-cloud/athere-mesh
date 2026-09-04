# Athere Checkpoints, Branching, Rollback, and Quarantine (Item 12)

Long missions recover without a full restart.

## What landed

Recovery-only mission-state operations on the existing service (not a parallel recovery system):

| Operation | Action | Effect |
| --- | --- | --- |
| `createCheckpoint` | `create_checkpoint` | Verified snapshot of recoverable work state + integrity hash |
| `createBranch` | `create_branch` | Alternate strategy branch from a verified checkpoint |
| `quarantineBranch` | `quarantine_branch` | Marks a failed strategy branch quarantined; returns `activeBranchId` to `main` |
| `rollbackToCheckpoint` | `rollback_to_checkpoint` | Restores known-good partitions; resumes `blocked` → `running` |
| `retryFromCheckpoint` | `retry_from_checkpoint` | Same restore path with retry lineage + environment resync |

## Recoverable snapshot

Checkpoints capture: `status`, `completedWork`, `pendingWork`, `failedWork`, `evidence`, `artifactReferences`, `activeAgents`, `environmentObservations`.

Immutable after create (as before): goals, subgoals, dependencies, `currentPlan`, `workflowGraph`.

`checkpoints` / `branches` / `activeBranchId` cannot be mutated through generic `transition()` updates.

## Authority

Recovery may emit `running` **only** for `rollback_to_checkpoint` and `retry_from_checkpoint` (resume after quarantine/block). It still cannot certify success or advance `completedWork`. Rollback/retry require `status === 'blocked'` and fail closed on `completed`. Snapshot restore does not write `status`; resume goes through `transitionMission`.

## Acceptance

An agent failure ~90% through a mission does not require restarting the entire mission: quarantine the failed branch, rollback/retry from the last verified checkpoint, continue with preserved completed work.

## Self-heal (durable)

- Orchestrator writes verified checkpoints after inspect and after successful tests.
- On executor/runtime failure: block → auto-heal from last checkpoint when one exists (cap: 3).
- Startup uses `recoverAndHealMissions`: interrupt → block → heal blocked missions that have verified checkpoints (quarantine active failed branch, then `retry_from_checkpoint`).
- Missions without checkpoints stay blocked (fail closed). Auto-heal stops after the cap to prevent loops.

## Evidence

- `tests/integration/mission-checkpoints-item12.test.js`
- `tests/integration/mission-self-heal.test.js`
- `packages/mission/src/mission-checkpoints.js`
- `packages/recovery/src/recovery-coordinator.js` (`healMissionFromCheckpoint`, `recoverAndHealMissions`)
- Recovery actions in `packages/contracts/src/execution-roles.js` / `agent-operation.js`
