# Titan — CURRENT (2026-07-27)

**Status label:** CURRENT — recreate through Slice 2  
**Not:** a restored copy of the wiped/rewrite-damaged Lenovo tree

## Role

Titan is the operator-facing **mission command** surface for Athere Mesh:

- Start / track missions
- Watch Resonance Bus signals
- Show Redis RAM pool health
- Surface proof artifacts

## Live now (Lenovo recreate)

- API + UI: `corepack pnpm run dev:api` → `http://127.0.0.1:5050/`
- Slices: fabric-ram-pool, resonance-bus, mission-command-ui
- Smokes: `smoke:redis`, `smoke:bus`, `smoke:ui`

## Recreate principles

1. Design → code (no persona rewrite theater).
2. Redis fabric first.
3. Proof-over-done from day one.
4. Tokenless-default / local-first.
5. Miss Vale and founder persona packs remain under hold / original-first rules — not reconstructed here.

## Slice order

See [PROGRESS.md](PROGRESS.md).
