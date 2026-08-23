# Titan — CURRENT (2026-07-27)

**Status label:** CURRENT — recreate through Slice 4 + S24 Redis Tailscale + Postgres durable Lenovo stand-in  
**Not:** a restored copy of the wiped/rewrite-damaged Lenovo tree

## Role

Titan is the operator-facing **mission command** surface for Athere Mesh:

- Start / track missions
- Watch Resonance Bus signals
- Show Redis RAM pool health
- Surface proof artifacts
- Durable mission/audit + mesh policy

## Live now (Lenovo recreate)

- API + UI: `corepack pnpm run dev:api` → `http://127.0.0.1:5050/`
- Tour: `/tour.html?slice=0..3`
- Slices: fabric-ram-pool, resonance-bus, mission-command-ui, durable-policy (+ durable-postgres when enabled)
- Smokes: `smoke:redis`, `smoke:redis-s24`, `smoke:bus`, `smoke:ui`, `smoke:durable`, `smoke:durable-postgres`
- Policy: tokenless-default; external models deny-by-default
- Durable default: `workspace/durable/` filesystem
- Durable Postgres: `ATHERE_DURABLE_BACKEND=postgres` → PGlite on Lenovo; set `DATABASE_URL` when Ubuntu control plane is online
- Contest: [JUDGE_PACK.md](JUDGE_PACK.md) · [CONTEST_DEMO_SCRIPT.md](CONTEST_DEMO_SCRIPT.md)

## Recreate principles

1. Design → code (no persona rewrite theater).
2. Redis fabric first.
3. Proof-over-done from day one.
4. Tokenless-default / local-first.
5. Miss Vale and founder persona packs remain under hold / original-first rules — not reconstructed here.

## Slice order

See [PROGRESS.md](PROGRESS.md).

## Programming backup

The verified 2026-08-23 Titan source backup is recorded in [TITAN_PROGRAMMING_BACKUP.md](TITAN_PROGRAMMING_BACKUP.md). The archive is stored privately under the existing Google Drive **Athere Mesh** folder with its size, SHA-256, contents, exclusions, test result, and status boundary documented there.

## Operating memory

Future Titan work must begin with [TITAN_OPERATING_MEMORY.md](TITAN_OPERATING_MEMORY.md), which records canonical GitHub and Drive locations, the verified Ichabod route, scope boundaries, and the current unproven Ollama loopback-hardening state.
