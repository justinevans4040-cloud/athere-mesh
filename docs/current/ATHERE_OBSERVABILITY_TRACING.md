# Athere Observability and Execution Tracing (Item 13)

Every mission produces a machine-readable execution trace so a failed run can be reconstructed afterward.

## What landed

- Module: `packages/mission/src/mission-execution-trace.js`
- Durable field: `mission.executionTrace` (append-only; not mutable via generic `transition()`)
- Auto-append on create, transition, fact ops, and recovery ops
- Optional `observability` bag on `transition()` for runtime tool/latency/model/token/cost events
- Orchestrator records inspect/test tool calls + latency into the bag
- `service.reconstruct({ missionId })` / `reconstructFailedMission(mission)` rebuild the timeline

## Captured kinds

`state_change`, `agent`, `model`, `input_contract`, `tool_call`, `verifier_decision`, `evidence`, `latency`, `token_usage`, `cost`, `retry`, `failure`, `rollback`

## Acceptance

Any failed (or healed) mission with durable history can be reconstructed from `executionTrace` into agents, tool calls, state changes, verifier decisions, metrics, failures, retries, and rollbacks.

## Security closes (hostile audit)

- `observability` keys are closed; unknown fields reject.
- Caps: max 8 tool calls, 8 models, 8192 serialized bytes.
- `toolCalls[].agentId` must match the authorized transition actor (fail closed); recorded agent is always the actor.
- `executionTrace` remains non-authoritative for MEA/QR18/idempotency/checkpoints.

## Evidence

- `tests/contract/mission-execution-trace.test.js`
- `tests/integration/mission-execution-trace-item13.test.js`
