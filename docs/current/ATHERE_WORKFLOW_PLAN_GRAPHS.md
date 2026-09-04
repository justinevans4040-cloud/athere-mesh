# Athere Workflow / Plan Graphs — CURRENT (2026-09-04)

**Status:** implemented. Backlog **Item 11**.

## Acceptance

> Athere knows not merely whether an action is legal, but whether execution remains on a valid mission path.

## What landed

- Contract: `packages/contracts/src/workflow-graph.js`
  - Node kinds: `goal`, `subgoal`, `action`, `verification_gate`, `recovery_path`
  - Edge kinds: `depends_on`, `blocks`, `satisfies`, `supersedes`, `retry_after`, `rollback_to`, `alternate_path`
  - `buildWorkflowGraph` / `assessMissionPath` / `assertValidMissionPath`
- Mission create persists `workflowGraph` derived from goals, subgoals, dependencies, and `currentPlan`
- Legacy `{ prerequisite, dependent }` edges normalize to typed `depends_on` (`from`/`to` preserved)
- Every work-partition mutation (`completedWork` / `pendingWork` / `failedWork`) fails closed if the path is invalid
- `workflowGraph` is immutable after create
- QR18 Level 5 uses `assessMissionPath` when a graph is present

## Path rules (enforced)

- `depends_on` / `blocks`: dependent cannot complete before prerequisite/`from`
- Plan order: later plan steps cannot complete while earlier steps are incomplete, unless an `alternate_path` edge to that later step is **armed** (`from` already completed)
- Unknown ids in completed/pending/failed work are invalid
- `supersedes` / `satisfies` do not waive `depends_on` or plan order
- `workflowGraph` is immutable after create

## What this does not do

- Item 12 checkpoints / branching / rollback / quarantine (edge kinds `rollback_to` / `retry_after` / `alternate_path` are representable; alternate_path is path-armed only — not a full recovery engine)
- Mutating the plan graph mid-mission (still create-time authority)
