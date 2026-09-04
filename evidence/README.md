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

**Stale command removed:** earlier revisions of this file documented
`corepack pnpm run smoke:redis-s24` against the S24 Termux node. That script does
not exist in this repository, so the two S24 artifacts above are kept as
historical records only and are not reproducible from here.
