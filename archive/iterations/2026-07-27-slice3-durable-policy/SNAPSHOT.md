# Iteration: 2026-07-27 Slice 3 — Durable + Policy

**Status:** landed (local Titan recreate + public evidence trail)  
**Tree:** `C:\Users\justi\WORKSPACE\Internal_Systems\athere-titan`  
**Nothing deleted** from prior iterations.

## What landed

- File-backed durable store: `workspace/durable/` (missions JSON + `audit.jsonl`)
- APIs: `GET /api/policy`, `GET /api/durable/missions`, `GET /api/durable/audit`
- Policy: **tokenless-default** + **external models deny-by-default** (`ALLOW_EXTERNAL_MODELS=1` unlock)
- Missions persist to durable + audit on complete / deny
- UI shows policy line
- `scripts/smoke-durable-policy.ps1` → **SMOKE_DURABLE_POLICY=PASS**
- Evidence: `evidence/smoke-durable-policy-20260727-130214.json`

## Not in this slice

- Live Postgres (Ubuntu/ichabod later — file store is approved Lenovo durable)
- Nosana GPU workload (credits still pending)
- Contest package polish (Slice 4)
