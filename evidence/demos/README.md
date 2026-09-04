# Athere Titan — Slice progression demos

Short screen recordings of the Lenovo recreate path (2026-07-27).  
Brand: *There is a there. It’s called Athere.*

**Not tracked in git** (bloat cleanup ckpt 92). MP4s may exist on this machine under this folder; they are gitignored. Prefer Releases / external store for sharing.

| Video (local filename) | Slice | What it shows |
|---|---|---|
| `athere-titan-slice0-demo.mp4` | **0 — Redis RAM fabric** | Pool health + set/get probe. Redis is shared mesh hot memory (not durable archive). |
| `athere-titan-slice1-demo.mp4` | **1 — Resonance Bus** | Mission run with typed signals `accepted → running → completed` plus proof SHA. Proof-over-“done.” |
| `athere-titan-slice2-demo.mp4` | **2 — Mission command UI** | Operator UI: intent → Start mission → causal river → COMS DONE + proof path. |
| `athere-titan-slice3-demo.mp4` | **3 — Durable + policy** | Tokenless-default; external models deny-by-default; mission saved to file durable store + audit. |

## How these were captured

- Live Titan API/UI on Lenovo: `http://127.0.0.1:5050/`
- Tour pages: `/tour.html?slice=0` … `slice=3`
- Playwright headless recording → ffmpeg H.264 MP4

## Reproduce locally

```text
cd C:\Users\justi\WORKSPACE\Internal_Systems\athere-titan
corepack pnpm run dev:api
# other terminal:
cd workspace\demos
node record-all-slice-demos.mjs
```

Nothing in prior iteration folders was deleted to add these demos.
