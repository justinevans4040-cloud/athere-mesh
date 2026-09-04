# Athere Remote Executor Dispatch — CURRENT (2026-09-03)

**Status:** implemented, opt-in. Doctrine-baseline **blocker 3** + standing worker + owner env auto-wire + lease reclaim + remote inspect.

This is not a numbered backlog item. It does not start Item 10 / QR18.

## What it is

Cross-host handoff for executor work: **`inspect-repository` (nyx)** and **`run-node-tests` (rune)**.

| Piece | Role |
|---|---|
| `packages/execution/src/remote-work-queue.js` | Redis (or in-memory) job queue with mesh seed guard, **lease claim**, heartbeat, and reclaim |
| `packages/execution/src/remote-dispatch-executor.js` | Executor facade: both `inspect` and `runTests` enqueue and await |
| `packages/execution/src/remote-executor-worker.js` | Worker claim → existing `createNodeTestExecutor` → complete (heartbeats while working) |
| `scripts/smoke-remote-executor-dispatch.js` | `dispatch` / `worker-once` / `await` smoke CLI |
| `scripts/smoke-remote-executor-cohort.js` | Multi-file contract cohort against the standing worker |
| `scripts/smoke-remote-work-lease.js` | Multi-worker lease reclaim smoke (isolated namespace) |
| `scripts/smoke-owner-api-mission.js` | Owner `orchestrator.execute()` over env-wired Redis + remote queue (+ optional Postgres) |
| `scripts/remote-executor-worker.js` | Long-running worker entry (poll loop) |
| `packages/orchestrator/src/mesh-env-wiring.js` | Env → Redis bus + optional remote queue + optional shared Postgres for `start-agent-api` |
| `deploy/systemd/athere-mesh-remote-executor.service` | Standing systemd **user** unit on Ichabod (`Restart=always`, linger) |

When `remoteWorkQueue` is injected, envelope input bindings hash the **worker** repository root (`remoteRepositoryRoot`). Auditor / proof paths stay on the owner host. Offline hermetic tests omit the queue and keep the previous in-process executor path.

`node-test-executor` authorizes `miss-vale-prime` envelopes with `state_version >=` the operation's minimum stage (inspect ≥2, test ≥3) so durable checkpoints after inspect do not falsely reject rune.

## Lease claim (multi-worker)

Claims are no longer LPOP-only. A claim places the job into a processing set with a lease expiry. A second worker cannot take it while the lease is live. Heartbeats extend the lease during long work. `reclaimExpired()` (also run inside `claim`) returns abandoned jobs to the queue for another worker.

## Fail-closed publish (named residual closed)

`createRedisResonanceBus` sets `failClosedOnPublish: true`. The orchestrator rethrows transport/auth/seed failures when that marker is present. Env auto-wire always injects that Redis bus (never a memory bus) when `ATHERE_MESH_REDIS_*` is set. The default memory bus still swallows publish errors so a telemetry outage cannot overturn durable mission state (existing contract).

## Owner / start-agent-api env auto-wire

| Variable | Meaning |
|---|---|
| `ATHERE_MESH_REDIS_*` | When set (with seed id), inject Redis resonance bus |
| `ATHERE_MESH_REMOTE_WORK_QUEUE` | `1` / `true` / `yes` / `on` — inject Redis remote work queue (requires Redis env) |
| `ATHERE_MESH_REMOTE_REPOSITORY_ROOT` | Path **on the worker host** for dispatched inspect + run-node-tests |
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

`--repository-root` / `ATHERE_MESH_REMOTE_REPOSITORY_ROOT` must be the path **on the worker host**.

## What this proves / does not prove

See the cross-host evidence JSON under `evidence/` (owner-api mission, cohort, lease, standing-worker, earlier blocker artifacts) and each file's `doesNotProve` list. Passing unit tests alone are not acceptance. Item 10 / QR18 is not started.
