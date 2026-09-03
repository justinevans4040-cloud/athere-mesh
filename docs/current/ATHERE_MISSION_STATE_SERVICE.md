# Athere Mission State Service

**Status:** implemented for Titan's operational mission path

The Mission State Service is the authoritative boundary for creating, mutating, persisting, reloading, and selecting mission state. Titan's orchestrator no longer constructs thin mission snapshots and writes them directly to the filesystem store.

## Owned state

Every new operational mission records:

- mission ID and objective;
- goals and subgoals;
- subgoal dependencies;
- completed, pending, and failed work partitions;
- evidence;
- constraints and permissions;
- active agents;
- artifact references;
- the current versioned plan;
- current environment observations;
- execution status and proof-bearing signals.

The service persists this record through the existing atomic, revision-checked mission store. Reconstructing the service and loading the mission recovers the complete record without relying on an agent conversation.

## Mutation boundary

- Every transition requires the expected persisted revision.
- Every creation, transition, and atomic fact mutation requires a caller-supplied operation ID bound to canonical operation content.
- Exact retries return the durable result without adding a revision; conflicting operation-ID reuse is rejected.
- Unknown authoritative fields are rejected.
- Work IDs must reference declared subgoals.
- Completed, pending, and failed work partitions cannot overlap.
- Active agents must have an explicit mission permission.
- Goals, subgoals, dependencies, and the current plan are immutable after creation in this service version; later versioned plan changes belong to the ordered state-lineage work.
- Existing mission transition and proof rules remain enforced.

## Selected agent state

`select()` and the orchestrator's `selectMissionState()` return only explicitly requested allowlisted fields, plus the mission ID and authoritative state version. Internal signals or permissions are not included unless the caller explicitly requests an allowed field.

## Production locations

- Service: `packages/mission/src/mission-state-service.js`
- Durable store: `packages/mission/src/mission-store.js`
- Titan integration: `packages/orchestrator/src/mission-orchestrator.js`
- Service tests: `tests/integration/mission-state-service.test.js`
- Orchestrator integration: `tests/integration/mission-orchestrator.test.js`

## Implemented reliability layers

The initial service completed backlog Item 3. The current implementation also carries the append-only hash-bound transition lineage from Item 4, semantic fact supersession from Item 5, artifact references from Item 6, and the idempotent mutation boundary from Item 8. Detailed contracts are in `ATHERE_STATE_TRANSITION_HISTORY.md`, `ATHERE_STATE_SUPERSESSION.md`, and `ATHERE_IDEMPOTENT_OPERATIONS.md`.

Operation-level rollback means a failed validation, permission check, timeout, or atomic publication leaves the previous authoritative revision intact. Branching, checkpoint restoration, and alternative-strategy rollback remain Item 12 rather than being overstated here.
