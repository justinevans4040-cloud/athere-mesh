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

## Remaining ordered work

This completes the external authoritative-state boundary required by backlog Item 3. It does not claim the append-only transition lineage, supersession semantics, or rollback required by later backlog items.
