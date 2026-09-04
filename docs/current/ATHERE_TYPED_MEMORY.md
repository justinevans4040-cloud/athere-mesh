# Athere Typed Memory (Item 14)

Split memory by kind without creating a parallel memory database. Typed memory is a **projection** over existing mission authority.

## Types

| Type | Role | Source of truth |
| --- | --- | --- |
| `working` | current state | mission status, work partitions, agents, observations, evidence |
| `episodic` | remembered history | `executionTrace`, mission `signals` |
| `semantic` | learned knowledge | `authoritativeFacts` (statuses preserved) |
| `procedural` | executable skill | `currentPlan`, `workflowGraph` |
| `artifact` | artifact memory | `artifactReferences` |
| `state_history` | prior authoritative states | `transitionHistory` |

Every projected entry carries: provenance, confidence, createdAt, validationState, supersession links (when present), accessPolicy.

## API

- `projectMissionMemory(mission, { types? })`
- `classifyMemoryEntry({ memoryType, ... })` → role (`current_state` / `remembered_history` / `learned_knowledge` / `executable_skill` / …)
- `service.memory({ missionId, types? })`

Writes still go through existing mission / fact / recovery / observability paths. Generic `transition()` cannot set `memory`.

## Acceptance

Athere can tell whether something is current state, remembered history, learned knowledge, or an executable skill (`assertMemoryKindsDistinct`).

## Not in Item 14

State-aware retrieval ranking is Item 15 — see `ATHERE_STATE_AWARE_RETRIEVAL.md`.

## Security closes (local hostile audit)

- Projection requires an authorized `reader` (`mission-state-service` | `orchestrator` | `auditor`); unknown readers fail closed.
- `accessPolicy` is enforced on every projected entry (`authorizeMemoryRead`); writes fail closed except `mission-state-service` (no write API — transition forge rejected via `authorizeMemoryWrite`).
- Caps: semantic 256, artifact 64, episodic 256, state_history 256 (fail closed when exceeded).
- Redaction: semantic fact **values**, observation values, evidence bodies, transition envelopes/input, and oversized tool dumps are not projected (`valueRedacted` / `envelopesRedacted` / `evidenceRedacted`). Use `facts()` / mission load for authoritative values.

## Evidence

- `packages/memory/src/typed-memory.js`
- `tests/contract/typed-memory.test.js`
- `tests/integration/typed-memory-item14.test.js`
