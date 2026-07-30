# Redis RAM Pool — CURRENT (2026-07-30)

**Status label:** CURRENT design target  
**Provenance:** derived from ATHERE Android RAM Pool handoff (Justin consolidation vault)

## Required result

- Each Android/Termux (and approved seed) node runs Redis contributing a fixed RAM budget (`maxmemory` + `allkeys-lru`).
- Bind exclusively to private **Tailscale** IPs — no public exposure.
- Titan / Dell / Lenovo build cells connect through any Tailscale startup node.
- One logical hot key-value fabric for agent scratch, Resonance Bus transport, and short-lived state.

## Public evidence

| Cut | Artifact | Result |
|---|---|---|
| Slice 0 embedded contract | [smoke-redis-pool-20260727-103136.json](../../evidence/smoke-redis-pool-20260727-103136.json) | PASS (`mode=embedded`) |
| S24 Termux over Tailscale | [smoke-s24-redis-tailscale-20260730-122029.json](../../evidence/smoke-s24-redis-tailscale-20260730-122029.json) | PASS (`mode=tcp`, node `justins-s24-termux`, 512MB `allkeys-lru`, probe set/get) |

## Durable vs hot

| Layer | Store | Role |
|---|---|---|
| Hot / shared edge | Redis RAM pool | Signals, scratch, short TTL state |
| Durable (next slices) | Postgres / object store | Missions, audit, proof metadata |

## Dev path (before phones)

Lenovo Docker / embedded Redis seed uses the **same client contract** as the Tailscale cluster so phone nodes join without rewriting Titan.

