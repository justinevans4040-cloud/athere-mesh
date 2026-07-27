<!-- provenance: derived | source: Android RAM Pool handoff via Justin consolidation 2026-07-27 -->

# IP Import — Redis RAM pool requirements (derived)

- Every Android/Termux device runs one Redis Cluster node (or compatible contributor).
- Bind exclusively to private Tailscale IP (no public exposure).
- Each phone contributes fixed RAM via `maxmemory` + `maxmemory-policy allkeys-lru`.
- Titan build cells (Dell/Lenovo) connect through any Tailscale startup node.

Full living doc: [docs/current/REDIS_RAM_POOL.md](../../docs/current/REDIS_RAM_POOL.md)
