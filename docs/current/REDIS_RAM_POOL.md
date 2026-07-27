# Redis RAM Pool — CURRENT (2026-07-27)

**Status label:** CURRENT design target  
**Provenance:** derived from ATHERE Android RAM Pool handoff (Justin consolidation vault)

## Required result

- Each Android/Termux (and approved seed) node runs Redis contributing a fixed RAM budget (`maxmemory` + `allkeys-lru`).
- Bind exclusively to private **Tailscale** IPs — no public exposure.
- Titan / Dell / Lenovo build cells connect through any Tailscale startup node.
- One logical hot key-value fabric for agent scratch, Resonance Bus transport, and short-lived state.

## Durable vs hot

| Layer | Store | Role |
|---|---|---|
| Hot / shared edge | Redis RAM pool | Signals, scratch, short TTL state |
| Durable (next slices) | Postgres / object store | Missions, audit, proof metadata |

## Dev path (before phones)

Lenovo Docker Redis seed uses the **same client contract** as the Tailscale cluster so phone nodes join without rewriting Titan.
