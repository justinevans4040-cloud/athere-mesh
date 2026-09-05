# Athere Active Run

**Status:** Active — **PRODUCTION PERFORM** (human work + phones + WLM). Local-only.

**Archive (ckpts 1–91):** `archive/runs/ATHERE_ACTIVE_RUN_ckpts_1-91_2026-09-04.md`

## Justin order (2026-09-04)

Spine death-tested. Now **perform**: real work + phones + WLM. Do not stop at QA-of-self.

## PRODUCTION PERFORM ladder

| # | Track | Deliverable | Status |
|---|---|---|---|
| 1 | **Perform** | First human command beyond self-test — inventory + proof | **DONE** — `evidence/smoke-owner-file-perform-20260905T002358Z.json` |
| 2 | **Perform** | Organize named folder by type + proof | **DONE** — same evidence (Desktop `athere-mesh-scratch`, 46 files moved) |
| 3 | **Perform** | Wire `build` Titan (MEA + proof); A→B on Ichabod | **DONE** — Lenovo `evidence/smoke-owner-titan-build-20260905T013334Z.json` (181 files); Ichabod `evidence/smoke-owner-titan-build-ichabod-20260905T013400Z.json` (175 files). NL: `Build Titan now` |
| 4 | **Phones** | Tailscale phone online smoke | **DONE** — `evidence/smoke-phone-tailscale-20260905T002434Z.json` (A15 + kftrwi; mesh Redis PONG) |
| 5 | **Phones / fleet** | Fleet + **S24 primary phone** | **DONE** — S24 `100.83.225.17`: Redis PONG + SSH `:8022`. Evidence `evidence/smoke-s24-primary-20260905T012844Z.json`. **A15 parked** (cracked screen). |
| 6 | **WLM/NYX** | Schema ladder step 1 in-repo | **DONE** — `packages/nyx/src/nyx-schema.js` + `tests/contract/nyx-schema.test.js` |
| 7 | **UX** | Plain language → perform | **DONE** — inventory/organize/scratch phrases in planner |
| 8 | **Ship** | Commit when Justin orders | WAITING |
| 9 | **Wake/FF data** | Inventory-first (~100GB); no full Lenovo dump | **DONE catalog** — bulk already on Ichabod `/mnt/storage` (**110.0 GB** indexed). Lenovo: `evidence/wake-forgefront-inventory-20260905T014300/` + S24 dump `evidence/s24-dump-20260905T014300/` (~718MB termux tgz). |

## Wake / ForgeFront data (ckpt 105)

- **Do not copy 100GB to Lenovo** (~38GB free).  
- **Bulk (measured):** Ichabod `WAKE` 15.8G + `forgefront-vault` 47.9G + `archive` 45.5G + `WAKE_OFFLOAD` 0.8G = **110.0 GB** — index: `/mnt/storage/wake-forgefront-MASTER-INDEX-20260905.json`  
- **Lenovo catalog:** `evidence/wake-forgefront-inventory-20260905T014300/MASTER-CATALOG.json`  
- **S24:** Downloads ~2.5G total; leave bulk in place; mesh dump pulled (inventory + termux-home.tgz).  
- **Next:** Organize on Ichabod (browse `/mnt/storage/WAKE` + `forgefront-vault`); selective scp only for chosen files.

## Active phone

**Primary:** Justins-S24 (`100.83.225.17`) — Redis `:6379`, SSH `:8022`.  
**Parked:** A15 — revisit when screen usable.

## How to run (owner)

- `Inventory my scratch folder` / `Organize my scratch folder by type`
- Fleet: `node scripts/mesh-register-tailscale-fleet.js`
- S24 check: `node scripts/smoke-s24-primary.js`
- File smoke: `node scripts/smoke-owner-file-perform.js`
- Titan build: `Build Titan now` / `node scripts/smoke-owner-titan-build.js`

## Prior (kept)

Death pack GREEN: soak 25, chaos 5, HTTP 5, live suite 438/0/0.

## Checkpoint history

98. Death pack.  
99. PRODUCTION PERFORM ladder opened.  
100. Owner file perform live.  
101. S24 Redis+SSH green; A15 Redis briefly worked then parked for screen.  
102. Fleet register for active Tailscale peers.  
103. **S24 set as primary phone** — keep rolling here; next open: Titan `build` A→B.  
104. **Titan build wired** — `execute_titan_build` / `titan-build-executor`; Lenovo + Ichabod smokes GREEN.  
105. **Wake/ForgeFront inventory-first** — 110GB on Ichabod `/mnt/storage`; Lenovo catalogs + S24 718MB dump only.  
106. S24 scattered py/json collect DONE — 361 files (217 py, 144 json, ~4.0MB) at evidence/s24-py-json-20260904T185520/ (phone ~/s24-py-json-collect/).
