# Athere Remote Executor Dispatch — CURRENT (2026-09-03)

**Status:** implemented, opt-in. Doctrine-baseline **blocker 3**.

This is not a numbered backlog item. It does not start Item 10 / QR18.

## What it is

Cross-host handoff for one subgoal: **`run-node-tests` (rune)**.

| Piece | Role |
|---|---|
| `packages/execution/src/remote-work-queue.js` | Redis (or in-memory) job queue with the same mesh seed guard as the resonance bus |
| `packages/execution/src/remote-dispatch-executor.js` | Executor facade: `inspect` stays local; `runTests` enqueues and awaits |
| `packages/execution/src/remote-executor-worker.js` | Worker claim → existing `createNodeTestExecutor` → complete |
| `scripts/smoke-remote-executor-dispatch.js` | `dispatch` / `worker-once` / `await` smoke CLI |
| `scripts/remote-executor-worker.js` | Long-running worker entry (poll loop) |

The mission orchestrator accepts an optional `remoteWorkQueue` (+ `remoteRepositoryRoot`). When injected, `run-node-tests` is dispatched remotely; inspect and auditor paths stay local. Offline hermetic tests omit the queue and keep the previous in-process executor path.

## Fail-closed publish (named residual closed)

`createRedisResonanceBus` sets `failClosedOnPublish: true`. The orchestrator rethrows transport/auth/seed failures when that marker is present. The default memory bus still swallows publish errors so a telemetry outage cannot overturn durable mission state (existing contract).

## Configuration

Reuses `ATHERE_MESH_REDIS_*` (same seed as blocker 1). Optional:

| Variable | Meaning |
|---|---|
| `ATHERE_MESH_WORK_NAMESPACE` | Work-queue key prefix. Defaults to `athere:mesh:work`. Use a unique value per smoke so runs do not collide. |

## Worker on Ichabod

```text
ATHERE_MESH_REDIS_HOST=127.0.0.1 \
ATHERE_MESH_REDIS_PORT=6380 \
ATHERE_MESH_REDIS_PASSWORD_FILE=$HOME/.config/athere-mesh-redis/mesh-redis.pass \
ATHERE_MESH_REDIS_SEED_ID=8a1e2c26-0769-405e-9a8f-85b4c2c9f1f1@ichabodcrane \
ATHERE_MESH_WORK_NAMESPACE=athere:mesh:work:smoke:<id> \
node scripts/remote-executor-worker.js --once
```

Or `pnpm run smoke:remote-executor -- worker-once` with the same env.

`--repository-root` on **dispatch** must be the path **on the worker host** (the checkout the worker will execute against).

## What this proves / does not prove

See the cross-host evidence JSON under `evidence/` and its `doesNotProve` list. Passing unit tests alone are not acceptance.
