# Evidence

Public smoke / demo artifacts for Athere Mesh Titan recreate.

| Artifact | What it proves |
|---|---|
| [smoke-redis-pool-20260727-103136.json](./smoke-redis-pool-20260727-103136.json) | Slice 0 Redis client contract (embedded Lenovo seed) |
| [smoke-s24-redis-tailscale-20260730-122029.json](./smoke-s24-redis-tailscale-20260730-122029.json) | Lenovo Titan → S24 Termux Redis over Tailscale (`tcp` / `justins-s24-termux`) |
| [smoke-resonance-bus-20260727-103621.json](./smoke-resonance-bus-20260727-103621.json) | Slice 1 Resonance Bus |
| [smoke-mission-ui-20260727-122848.json](./smoke-mission-ui-20260727-122848.json) | Slice 2 Mission command UI |
| [smoke-durable-policy-20260727-130214.json](./smoke-durable-policy-20260727-130214.json) | Slice 3 Durable + policy |
| [smoke-durable-postgres-20260730-123416.json](./smoke-durable-postgres-20260730-123416.json) | Postgres durable client contract (Lenovo PGlite; Ubuntu when online) |
| [smoke-arweave-20260730-s24-redis.json](./smoke-arweave-20260730-s24-redis.json) | Arweave permanence — S24 Redis smoke pinned (`winc=0`) |
| [smoke-redis-resonance-crosshost-20260903-182344.json](./smoke-redis-resonance-crosshost-20260903-182344.json) | Redis resonance bus — signal published on `JustinLenovo` read back by a process on `ichabodcrane`, 3 rounds. **Transport only**; the file's `doesNotProve` list is the authoritative scope. |
| [smoke-shared-mission-state-crosshost-20260903-201846.json](./smoke-shared-mission-state-crosshost-20260903-201846.json) | Shared mission state — Lenovo write into Ichabod Postgres `athere_mesh`, Ichabod read same revision/objective, 3 rounds. **State only.** |
| [smoke-remote-executor-crosshost-20260903-202947.json](./smoke-remote-executor-crosshost-20260903-202947.json) | Remote executor dispatch — Lenovo enqueues `run-node-tests`; Ichabod worker claimed **per-round via SSH** (blocker 3 land). See `doesNotProve`. |
| [smoke-remote-executor-standing-worker-crosshost-20260903-203851.json](./smoke-remote-executor-standing-worker-crosshost-20260903-203851.json) | Standing Ichabod systemd user worker — Lenovo publishes 3 jobs; unit `athere-mesh-remote-executor.service` claims them with **no mid-flight SSH claim**; worker PID = unit MainPID all rounds. |
| [smoke-remote-work-lease-20260904T035458.json](./smoke-remote-work-lease-20260904T035458.json) | Multi-worker lease reclaim — Worker A abandons; after expiry Worker B claims. Beyond LPOP-only. |
| [smoke-remote-executor-cohort-crosshost-20260904T035619.json](./smoke-remote-executor-cohort-crosshost-20260904T035619.json) | Standing worker runs a 4-file contract cohort (20 tests), not pin-only; no mid-flight SSH claim. |
| [smoke-owner-api-mission-crosshost-20260904T035714.json](./smoke-owner-api-mission-crosshost-20260904T035714.json) | Historical owner `orchestrator.execute()` A→B (pre-checkpoint `state_version` equality). Superseded for current tree by 20260904T214254. |
| [smoke-owner-api-mission-crosshost-20260904T214254.json](./smoke-owner-api-mission-crosshost-20260904T214254.json) | **Current-tree** owner A→B: Redis + remote queue + Postgres; standing worker; mission `mission-7c820439-…` revision 7 `completed` in `titan_missions`; executor `state_version >=` fix. |
| [arweave/](./arweave/) | Arweave permanence folder + README |
| [demos/](./demos/) | Slice 0–3 demo MP4s |
| [nosana/](./nosana/) | Nosana GPU smoke (started then stopped) |

## Reproduce

Cross-host resonance transport. Publish from this host, then read from the seed host:

```text
ATHERE_MESH_REDIS_HOST=100.77.131.28 \
ATHERE_MESH_REDIS_PORT=6380 \
ATHERE_MESH_REDIS_PASSWORD_FILE=/path/to/mesh-redis.pass \
ATHERE_MESH_REDIS_SEED_ID=<seed-uuid>@ichabodcrane \
corepack pnpm run smoke:redis-resonance publish --mission mission-demo --signal mission-demo-s1

# then, on the seed host:
ATHERE_MESH_REDIS_HOST=127.0.0.1 ATHERE_MESH_REDIS_PORT=6380 \
ATHERE_MESH_REDIS_PASSWORD_FILE=$HOME/.config/athere-mesh-redis/mesh-redis.pass \
ATHERE_MESH_REDIS_SEED_ID=<seed-uuid>@ichabodcrane \
node scripts/smoke-redis-resonance.js read --mission mission-demo
```

The password is never stored in this repository. Supply it with
`ATHERE_MESH_REDIS_PASSWORD_FILE` (preferred) or `ATHERE_MESH_REDIS_PASSWORD`.

Cross-host shared mission state (Postgres). Write from this host through the
configured URL, then read on the database host:

```text
ATHERE_MESH_POSTGRES_URL=postgres://athere_mesh@127.0.0.1:15432/athere_mesh \
ATHERE_MESH_POSTGRES_PASSWORD_FILE=/path/to/mesh-postgres.pass \
corepack pnpm run smoke:shared-mission-state write --mission mission-shared-demo

# then, on the database host (loopback):
ATHERE_MESH_POSTGRES_URL=postgres://athere_mesh@127.0.0.1:5432/athere_mesh \
ATHERE_MESH_POSTGRES_PASSWORD_FILE=$HOME/.config/athere-mesh-postgres/mesh-postgres.pass \
node scripts/smoke-shared-mission-state.js read --mission mission-shared-demo
```

Cross-host remote executor dispatch (blocker 3). Dispatcher on this host,
worker on the seed host against the same work namespace:

```text
ATHERE_MESH_REDIS_HOST=100.77.131.28 \
ATHERE_MESH_REDIS_PORT=6380 \
ATHERE_MESH_REDIS_PASSWORD_FILE=/path/to/mesh-redis.pass \
ATHERE_MESH_REDIS_SEED_ID=<seed-uuid>@ichabodcrane \
ATHERE_MESH_WORK_NAMESPACE=athere:mesh:work:smoke:<id> \
corepack pnpm run smoke:remote-executor -- dispatch \
  --job job-demo --mission mission-demo \
  --repository-root /home/the_founder/athere-mesh-crosshost \
  --test-file tests/contract/remote-executor-smoke-pin.test.js

# then, on the seed host (same WORK_NAMESPACE):
ATHERE_MESH_REDIS_HOST=127.0.0.1 ATHERE_MESH_REDIS_PORT=6380 \
ATHERE_MESH_REDIS_PASSWORD_FILE=$HOME/.config/athere-mesh-redis/mesh-redis.pass \
ATHERE_MESH_REDIS_SEED_ID=<seed-uuid>@ichabodcrane \
ATHERE_MESH_WORK_NAMESPACE=athere:mesh:work:smoke:<id> \
node scripts/smoke-remote-executor-dispatch.js worker-once

# then await on the dispatcher host:
corepack pnpm run smoke:remote-executor -- await --job job-demo --await-ms 60000
```

Standing worker (preferred). Unit already enabled on Ichabod; dispatcher only:

```text
# on Ichabod once: systemctl --user enable --now athere-mesh-remote-executor.service
ATHERE_MESH_REDIS_HOST=100.77.131.28 \
ATHERE_MESH_REDIS_PORT=6380 \
ATHERE_MESH_REDIS_PASSWORD_FILE=/path/to/mesh-redis.pass \
ATHERE_MESH_REDIS_SEED_ID=<seed-uuid>@ichabodcrane \
ATHERE_MESH_WORK_NAMESPACE=athere:mesh:work \
corepack pnpm run smoke:remote-executor -- dispatch \
  --job job-standing-demo --mission mission-standing-demo \
  --repository-root /home/the_founder/athere-mesh \
  --test-file tests/contract/remote-executor-smoke-pin.test.js \
  --await-ms 60000
```

**Stale command removed:** earlier revisions of this file documented
`corepack pnpm run smoke:redis-s24` against the S24 Termux node. That script does
not exist in this repository, so the two S24 artifacts above are kept as
historical records only and are not reproducible from here.
