# Athere Remote Executor Dispatch — CURRENT (2026-09-03)

**Status:** implemented, opt-in. Doctrine-baseline **blocker 3** + standing worker + owner env auto-wire.

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
| `packages/orchestrator/src/mesh-env-wiring.js` | Env → Redis bus + optional remote queue + optional shared Postgres for `start-agent-api` |
| `deploy/systemd/athere-mesh-remote-executor.service` | Standing systemd **user** unit on Ichabod (`Restart=always`, linger) |

The mission orchestrator accepts an optional `remoteWorkQueue` (+ `remoteRepositoryRoot`). When injected, `run-node-tests` is dispatched remotely; inspect and auditor paths stay local. Offline hermetic tests omit the queue and keep the previous in-process executor path.

## Fail-closed publish (named residual closed)

`createRedisResonanceBus` sets `failClosedOnPublish: true`. The orchestrator rethrows transport/auth/seed failures when that marker is present. Env auto-wire always injects that Redis bus (never a memory bus) when `ATHERE_MESH_REDIS_*` is set. The default memory bus still swallows publish errors so a telemetry outage cannot overturn durable mission state (existing contract).

## Owner / start-agent-api env auto-wire

| Variable | Meaning |
|---|---|
| `ATHERE_MESH_REDIS_*` | When set (with seed id), inject Redis resonance bus |
| `ATHERE_MESH_REMOTE_WORK_QUEUE` | `1` / `true` / `yes` / `on` — inject Redis remote work queue (requires Redis env) |
| `ATHERE_MESH_REMOTE_REPOSITORY_ROOT` | Path **on the worker host** for dispatched `run-node-tests` |
| `ATHERE_MESH_WORK_NAMESPACE` | Work-queue key prefix. Defaults to `athere:mesh:work` |
| `ATHERE_MESH_POSTGRES_*` / `DATABASE_URL` | When set, inject shared Postgres mission store |

Unset mesh Redis → offline default (memory bus, filesystem store, local executor).

## Standing worker on Ichabod

Unit: `~/.config/systemd/user/athere-mesh-remote-executor.service`  
Env: `~/.config/athere-mesh-worker/worker.env` (mode 600; template in `deploy/systemd/athere-mesh-remote-executor.env.example`)  
Checkout: `~/athere-mesh`  
Install helper: `deploy/systemd/install-remote-executor-worker.sh`

```text
systemctl --user enable --now athere-mesh-remote-executor.service
# linger already yes for the_founder — required so the unit survives logout
```

One-shot / smoke without the unit (still useful for local probes):

```text
ATHERE_MESH_REDIS_HOST=127.0.0.1 \
ATHERE_MESH_REDIS_PORT=6380 \
ATHERE_MESH_REDIS_PASSWORD_FILE=$HOME/.config/athere-mesh-redis/mesh-redis.pass \
ATHERE_MESH_REDIS_SEED_ID=8a1e2c26-0769-405e-9a8f-85b4c2c9f1f1@ichabodcrane \
ATHERE_MESH_WORK_NAMESPACE=athere:mesh:work:smoke:<id> \
node scripts/remote-executor-worker.js --once
```

`--repository-root` on **dispatch** must be the path **on the worker host**.

## What this proves / does not prove

See the cross-host evidence JSON under `evidence/` (standing-worker artifact and earlier blocker-3 artifact) and each file's `doesNotProve` list. Passing unit tests alone are not acceptance.
