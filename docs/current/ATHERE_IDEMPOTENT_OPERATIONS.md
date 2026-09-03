# Athere Idempotent Operation Contract

**Status:** implemented for the current authoritative mission path  
**Backlog:** `research/ATHERE_MESH_MODIFICATION_BACKLOG_2026-08-25.md`, Item 8

## Mutation boundary

Production mission mutations enter through `createMissionStateService`. Mission creation, mission transitions, and each atomic authoritative-fact operation require a caller-supplied operation ID. The filesystem mission store and PostgreSQL snapshot store are persistence adapters; they are not agent-facing mutation contracts.

Universal agent envelopes also require `operation_id`. The operational orchestrator assigns stable IDs to mission creation and to the state mutations that record supervision, repository inspection, test results, proof publication, artifact-provenance publication, completion, and failure blocking. Startup recovery routes authoritative missions through the same state service with a stable recovery operation ID.

## Duplicate and retry semantics

Each committed state transition binds its operation ID to a canonical SHA-256 hash of the operation input. An exact retry returns the current durable record with `duplicate: true` and the original `operationVersion`; it does not append another transition. Reusing an ID with different content raises an idempotency conflict.

Concurrent retries are resolved after the persistence adapter's compare-and-swap boundary. A caller that loses the write race reloads the committed lineage and receives the same duplicate result. Lock contention is retried only within a bounded operation window; exhaustion raises an explicit timeout error.

## Transaction, rollback, and failure behavior

Mission snapshots use revision compare-and-swap plus temporary-file publication under an ownership-checked lock. State validation, permission checks, and fact-lineage validation complete before publication. A failed or timed-out mutation therefore leaves the prior authoritative revision intact and the operation ID unconsumed, permitting a safe retry.

Mission proof and artifact-provenance publication use immutable create-only hard-link publication. Exact retries return the existing hash-bound result. Conflicting content cannot overwrite an accepted proof. Temporary candidates are removed after success or failure.

Agent execution receives an abort signal and a bounded envelope timeout. Operational executor failures become durable blocked mission states with pending work moved to `failedWork`; they cannot produce completion proof. Full checkpoint branching and arbitrary long-horizon rollback remain the separate scope of backlog Item 12.

## Acceptance evidence

- `tests/integration/mission-state-service.test.js`: required IDs, exact/conflicting retries, concurrent durable-store convergence, timeout, and no-partial-state rollback.
- `tests/integration/mission-state-fact-operations.test.js`: required IDs and sequential/concurrent retry behavior for atomic fact mutations.
- `tests/contract/agent-envelope.test.js`: required protocol operation IDs and enforced abortable timeouts.
- `tests/integration/proof-integrity.test.js` and `tests/integration/artifact-proof.test.js`: immutable proof publication, exact retry, and conflict rejection.
- `tests/integration/recovery-coordinator.test.js`: recovery idempotence, concurrent convergence, and authoritative lineage preservation.
- `tests/integration/mission-orchestrator.test.js`: durable blocked failure states and proof-gated completion.

The falsifiable acceptance claim is: sending the same state-changing request more than once, including concurrently, produces one durable mutation; sending different content under the same operation identity is rejected.
