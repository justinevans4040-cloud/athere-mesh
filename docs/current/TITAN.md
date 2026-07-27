# Titan — CURRENT (2026-07-27)

**Status label:** CURRENT — recreate through Slice 4 (contest pack on GitHub)  
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
- Slices: fabric-ram-pool, resonance-bus, mission-command-ui, durable-policy
- Smokes: `smoke:redis`, `smoke:bus`, `smoke:ui`, `smoke:durable`
- Policy: tokenless-default; external models deny-by-default
- Durable: `workspace/durable/` (Postgres later on Ubuntu)
- Contest: [JUDGE_PACK.md](JUDGE_PACK.md) · [CONTEST_DEMO_SCRIPT.md](CONTEST_DEMO_SCRIPT.md)

## Recreate principles

1. Design → code (no persona rewrite theater).
2. Redis fabric first.
3. Proof-over-done from day one.
4. Tokenless-default / local-first.
5. Miss Vale and founder persona packs remain under hold / original-first rules — not reconstructed here.

## Slice order

See [PROGRESS.md](PROGRESS.md).
