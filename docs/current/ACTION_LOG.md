# Action Log — Public Traceability

Append-only record of material public-repo actions.

## 2026-07-27 — Direction align (Slice G)

**Actor:** Cursor (parent agent; no subagents) under Justin execute order  
**Remote:** https://github.com/justinevans4040-cloud/athere-mesh  
**Local:** `C:\Users\justi\Desktop\athere-mesh`

### Actions

1. Created `archive/iterations/2026-07-brochure-v0/` with exact copies of pre-rewrite `README`, `CONTRIBUTING`, and all `docs/*`, plus `MANIFEST.json` SHA-256 hashes and `SNAPSHOT.md`.
2. Added `docs/current/` (DIRECTION, REDIS_RAM_POOL, RESONANCE_BUS, TITAN, PROGRESS, ACTION_LOG).
3. Rewrote root `README.md` and living docs intros/explanations to CURRENT direction; each living doc links to brochure archive (nothing deleted).
4. Added `archive/ip-imports/` excerpts with provenance labels.
5. Added empty `evidence/` placeholder for future smoke artifacts.
6. Commit + push to `origin/master` (no force-push; history preserved).

### Intent

Align public GitHub with recreate direction (Athere name line, Redis RAM share, Titan recreate, Resonance Bus, proof-over-done) while keeping full iteration trail for Decentralize AI / HackerNoon judges.

## 2026-07-27 � Slice 0 Redis fabric scaffold (Lenovo)

**Actor:** Cursor parent agent  
**Tree:** `C:\Users\justi\WORKSPACE\Internal_Systems\athere-titan` (clean recreate; leftover node_modules removed)

### Actions

1. Scaffolded pnpm monorepo + `@athere/api-server` with `GET /api/fabric/ram-pool` and `POST /api/fabric/probe`.
2. Added `docker-compose.yml` Redis (Docker not installed on Lenovo yet � compose ready for when available).
3. Embedded Redis via `redis-memory-server` for smoke (same client contract).
4. `scripts/smoke-redis-pool.ps1` ? **SMOKE_REDIS_POOL=PASS** (evidence copied under `evidence/`).


## 2026-07-27 � Slice 1 Resonance Bus

**Actor:** Cursor parent agent (no subagents)  
**Tree:** `C:\Users\justi\WORKSPACE\Internal_Systems\athere-titan`

### Actions

1. Added typed Resonance Bus on Redis lists (`athere:bus:signals` / per-mission keys).
2. APIs: `POST /api/missions` (run deterministic worker), `GET /api/missions/:id`, `GET|POST /api/bus/signals`.
3. Proof artifacts under `workspace/proofs/mission-<id>.json` with SHA-256 on completed signal.
4. `scripts/smoke-resonance-bus.ps1` ? **SMOKE_RESONANCE_BUS=PASS**; typecheck pass.
5. Evidence + `archive/iterations/2026-07-27-slice1-resonance-bus/` added (nothing deleted).

## 2026-07-27 — Slice 2 Mission Command UI

**Actor:** Cursor parent agent (no subagents)  
**Tree:** `C:\Users\justi\WORKSPACE\Internal_Systems\athere-titan`

### Actions

1. Added static UI at `/` (index + styles + app.js) served by Express from `artifacts/api-server/public/`.
2. Operator flow: enter intent → Start mission → causal river of Resonance Bus signals → COMS DONE + proof SHA/path.
3. Healthz now reports slice `mission-command-ui`.
4. `scripts/smoke-mission-ui.ps1` → **SMOKE_MISSION_UI=PASS**; `@athere/api-server` typecheck pass.
5. Evidence + `archive/iterations/2026-07-27-slice2-mission-ui/` added (nothing deleted).

## 2026-07-27 — Slice 3 Durable + Policy

**Actor:** Cursor parent agent (no subagents)  
**Tree:** `C:\Users\justi\WORKSPACE\Internal_Systems\athere-titan`

### Actions

1. Added file durable store under `workspace/durable/` (missions + `audit.jsonl`); Postgres deferred to Ubuntu/control plane.
2. Policy: tokenless-default; external models deny-by-default (`ALLOW_EXTERNAL_MODELS=1` unlock).
3. APIs: `GET /api/policy`, `GET /api/durable/missions`, `GET /api/durable/audit`; missions persist + audit.
4. UI policy line; healthz slice `durable-policy`.
5. `scripts/smoke-durable-policy.ps1` → **SMOKE_DURABLE_POLICY=PASS**; typecheck pass.
6. Evidence + `archive/iterations/2026-07-27-slice3-durable-policy/` added (nothing deleted).

## 2026-07-27 — Slice progression demo videos

**Actor:** Cursor parent agent (no subagents)

### Actions

1. Added Titan `/tour.html?slice=0..3` explanation pages (what each slice means + live run).
2. Recorded Playwright → ffmpeg MP4 demos for Slices 0–3 with on-page explanations.
3. Published under `evidence/demos/` with README index (nothing deleted from prior evidence).

## 2026-07-27 — Slice 4 Contest package

**Actor:** Cursor parent agent (no subagents)

### Actions

1. Added `docs/current/JUDGE_PACK.md` (one-page reviewer index).
2. Added `docs/current/CONTEST_DEMO_SCRIPT.md` (timed &lt;10 minute live/video script).
3. Added `docs/current/HACKERNOON_BUILD_POST_DRAFT.md` (paste-ready Round 1 build update; not auto-published).
4. Linked pack from root README + PROGRESS; archived iteration snapshot (nothing deleted).

## 2026-07-27 — Nosana GPU smoke (paid credits)

**Actor:** Justin (ops) + Cursor (evidence filing)

### Actions

1. Justin funded ~$10 Nosana credits; created `athere-mesh-wlm-smoke` (Simple, 1 replica, 1h, NVIDIA 3060).
2. JupyterLab ran smoke cell: `athere-nosana-smoke Linux-6.17.0-41-generic-x86_64-with-glibc2.35`.
3. Deployment **stopped** immediately after proof.
4. Evidence filed under `evidence/nosana/` (JSON + screenshot + README).

## 2026-07-30 — S24 Redis over Tailscale

**Actor:** Justin (Termux Redis) + Cursor (smoke + public filing)

### Actions

1. Confirmed `justins-s24` online on Tailscale; Termux `redis-server` on `100.83.225.17:6379`.
2. Ran `REDIS_URL` / `REDIS_EMBEDDED=0` smoke → PASS (`justins-s24-termux`, tcp, PONG + set/get).
3. Filed + pushed `evidence/smoke-s24-redis-tailscale-20260730-122029.json`.

## 2026-07-30 — Postgres durable (Lenovo stand-in)

**Actor:** Cursor (Ubuntu/ichabodcrane still offline)

### Actions

1. Added Postgres durable backend (`ATHERE_DURABLE_BACKEND=postgres`): PGlite on Lenovo; `DATABASE_URL` for Ubuntu later.
2. `scripts/smoke-durable-postgres.ps1` → **SMOKE_DURABLE_POSTGRES=PASS**; filesystem smoke still PASS.
3. Filed public evidence `evidence/smoke-durable-postgres-20260730-123416.json`; refreshed JUDGE_PACK + PROGRESS.

## 2026-07-30 — Arweave permanence (S24 Redis smoke)

**Actor:** Cursor (Turbo free &lt;100 KiB path)

### Actions

1. Authenticated Turbo upload of `smoke-s24-redis-tailscale-20260730-122029.json` (`winc=0`).
2. TX id `SdrVKy0BCjDMhIQQO7Igt-wSNvOSKq5zCXOXBbOGpe4`; gateway verify SHA-256 match on `arweave.net`.
3. Filed `evidence/smoke-arweave-20260730-s24-redis.json` + `evidence/arweave/`; refreshed JUDGE_PACK + PROGRESS.

