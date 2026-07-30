# Evidence

Public smoke / demo artifacts for Athere Mesh Titan recreate.

| Artifact | What it proves |
|---|---|
| [smoke-redis-pool-20260727-103136.json](./smoke-redis-pool-20260727-103136.json) | Slice 0 Redis client contract (embedded Lenovo seed) |
| [smoke-s24-redis-tailscale-20260730-122029.json](./smoke-s24-redis-tailscale-20260730-122029.json) | Lenovo Titan → S24 Termux Redis over Tailscale (`tcp` / `justins-s24-termux`) |
| [smoke-resonance-bus-20260727-103621.json](./smoke-resonance-bus-20260727-103621.json) | Slice 1 Resonance Bus |
| [smoke-mission-ui-20260727-122848.json](./smoke-mission-ui-20260727-122848.json) | Slice 2 Mission command UI |
| [smoke-durable-policy-20260727-130214.json](./smoke-durable-policy-20260727-130214.json) | Slice 3 Durable + policy |
| [demos/](./demos/) | Slice 0–3 demo MP4s |
| [nosana/](./nosana/) | Nosana GPU smoke (started then stopped) |

Reproduce S24 cut from runtime `athere-titan`:

```text
REDIS_URL=redis://100.83.225.17:6379 REDIS_EMBEDDED=0 corepack pnpm run smoke:redis-s24
```
