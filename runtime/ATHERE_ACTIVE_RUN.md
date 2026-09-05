# Athere Active Run

**Status:** Active — **FULL FLEET ONLINE** + **keep-mesh / add-agents**. Vale Prime sole Miss Vale. NYX Apex Coder routed on default path. Command Deck live. Local-only.

**Archive (ckpts 1–91):** `archive/runs/ATHERE_ACTIVE_RUN_ckpts_1-91_2026-09-04.md`

## Justin order (2026-09-05)

Designs are not editable without express permission. Search everywhere before building. Full fleet functional — nothing left unbound. Hostile audit + repair on every material change.

**Sellable bar (Justin):** Safety audits for bad actors every round. Clear bloat every round. Engineer-scrutiny standard — not demo theater.

**Roster rules (Justin):**
- **Vale Prime** (`miss-vale-prime`) is the **only** Miss Vale. No Agent Vale / Miss Vale Core as Miss Vale.
- **Houston** is a label only — agents matter (NYX, LOOM, RUNE, ECHO, Caretaker, Britt, Sentinel, …), not the Houston name.
- NotebookLM has **many** notebooks; do not treat one dump §25 or one notebook as the whole bible.

## FORGEFRONT BY WAKE INDUSTRIES (ckpt 114) — Justin 2026-09-05

**Orders:** Dispose fell-through job APIs. Rebrand DCE Solar + PM engine as **ForgeFront by Wake Industries**. Do **not** erase the solar sales vertical (still marketable to local solar companies).

| Action | Result |
|---|---|
| Job APIs disposed | Sara packet, Illinois Shines job scripts, noon pack job docs, portal packet builder → archived `~/forgefront/forgefront-meta/disposed-job-apis-20260905/` |
| Brand | Health API: `product=ForgeFront`, `brand=ForgeFront by Wake Industries`; UI title `ForgeFront // Command` |
| Call engine | LightReach/Illinois Shines defaults removed; company identity claim-gated |
| API aliases | `/api/forgefront/copilot/*` → existing copilot handlers; `/api/solar/copilot/*` kept one release for compat |
| Evidence | Ichabod live health + `evidence/forgefront-rebrand-20260905T050816Z.json`; unit tests **42/42 GREEN** |

**Live:** `solar-command.service` still runs the same package path (name of systemd unit unchanged this pass — product brand is ForgeFront).

## ONE COPY EACH APP (ckpt 120) — Justin 2026-09-05

**Order:** One copy of each app; delete the rest.

| App | Sole live file | URL |
|---|---|---|
| Solar | `~/forgefront/solar-command/DCE_Command_Center_V3.html` | `http://127.0.0.1:18787/` |
| PM | `~/forgefront/solar-command/ForgeFront_PM.html` | `http://127.0.0.1:18787/pm` |

Deleted on Ichabod: V3 twin, SolarCommand_V3_LIVE, all `.bak*`, meta pre-wipe/pre-rebrand snapshots, vault DO_NOT_USE package trees, job-archive UI snapshots, wakecodex artifact copy. Drive DO_NOT_USE packages purged. Lenovo evidence app extracts deleted. Phone CrossDevice copies **blocked** (cloud placeholder access denied — delete on S24 Downloads manually if still listed).

## SOLAR + PM SPLIT RESTORED (ckpt 119) — Justin 2026-09-05

**Order:** Put the two apps back the way they were (separate). No merge.

| App | URL (Lenovo tunnel) | File |
|---|---|---|
| **Solar / call** (default) | `http://127.0.0.1:18787/` | `DCE_Command_Center_V3.html` restored from `.bak-forgefront-systems` (+ `/solar` → `SolarCommand_V3_LIVE.html`) |
| **Project Management** (standalone) | `http://127.0.0.1:18787/pm` | `ForgeFront_PM.html` (PM UI separate; empty seed, no Nova demo) |

Evidence: `evidence/forgefront-split-restore-20260905.json` (`home_is_solar` + `pm_is_pm`, `nova_in_pm: false`).

## LIVE VS DO_NOT_USE — ALL PROJECTS (ckpt 118) — Justin 2026-09-05

**Order:** Every project must split LIVE / ARCHIVE_ONLY / ZZ_DO_NOT_USE so agents cannot pull dirty packages forward.

| Layer | Location |
|---|---|
| User Cursor rule (always) | `~/.cursor/rules/live-vs-do-not-use.mdc` |
| Mesh Cursor rule | `.cursor/rules/forgefront-do-not-use-dirty-packages.mdc` |
| Vault doctrine | `/mnt/storage/forgefront-vault/01_CANONICAL/LIVE_VS_DO_NOT_USE.md` |
| Global quarantine | vault `02_PROJECTS/ZZ_DO_NOT_USE__DIRTY_OR_DUPLICATE_PACKAGES__NEVER_SERVE_AS_LIVE/` |
| Drive banner | `gdrive:00_LIVE_VS_DO_NOT_USE__READ_ME_FIRST.md` |
| Evidence | `evidence/live-vs-do-not-use-rollout-20260905.json` |

Applied: home loose zips quarantined; `solar-command-latest` quarantined; ODIN security-backup dirs labeled DO_NOT_USE; athere-titan* labeled not-live; vault projects labeled.

## FORGEFRONT SYSTEMS + DO_NOT_USE QUARANTINE (ckpt 117) — Justin 2026-09-05

**Order:** Dirty DCE/Audited packages must not be pullable as live. Rename product to **ForgeFront Systems**. Empty seed — no fake demo projects.

| Rule | Path |
|---|---|
| **LIVE ONLY** | Ichabod `~/forgefront/solar-command/` → title/health **ForgeFront Systems**; storage `forgefront-systems-v1`; empty projects |
| **DO NOT USE (vault)** | `/mnt/storage/forgefront-vault/02_PROJECTS/ZZ_DO_NOT_USE__DIRTY_DCE_PACKAGES__NEVER_SERVE_AS_LIVE/` |
| **DO NOT USE (Drive)** | `DCE_Command_Center_V3_Package/ZZ_DO_NOT_USE__DIRTY_DCE_PACKAGES__NEVER_SERVE_AS_LIVE/` (Solar_V1 zips moved here) |
| Job archive (history only) | vault + Drive `ARCHIVES/...` — banners say DO NOT SERVE AS LIVE |
| Meta pointer | `~/forgefront/forgefront-meta/LIVE_PRODUCT.md` |

**Evidence:** live home shows Control Room + empty Portfolio (no Nova/Helix); health `product`/`brand` = ForgeFront Systems; residual scan clean. Agents must never serve Audited zips on alternate ports.


## SARA / IL SHINES ARCHIVE LABELED (ckpt 116) — Justin 2026-09-05

Superseded for *usage* by ckpt 117 quarantine. Archive retained; not live.

| Location | Path |
|---|---|
| Canonical vault (Ichabod) | `/mnt/storage/forgefront-vault/02_PROJECTS/DCE_SOLAR_COMMAND__SARA_IL_SHINES_JOB_FELL_THROUGH__ARCHIVED_20260905/` |
| Meta symlink | `~/forgefront/forgefront-meta/ARCHIVE__SARA_IL_SHINES_JOB_FELL_THROUGH__20260905` |
| Google Drive | `DCE_Command_Center_V3_Package/ARCHIVES/...` |
| Git pointer | `evidence/archives/README_SARA_IL_SHINES_JOB_ARCHIVE_2026-09-05.md` |

Portal token stays local-only — not in Drive/git archive.

## OLD SOLAR JOB COPY WIPE (ckpt 115) — Justin 2026-09-05

| Claim | Evidence |
|---|---|
| Illinois Shines / LightReach / Sara campaign / Agent 32 copy wiped from ForgeFront UI + copilot | `evidence/wipe-old-solar-copy-20260905T070147Z.json` (`residuals: {}`) |
| Seed company identity no longer auto-approves job vendor | HTML `seedTalkDefaults` → empty + `companyIdentityApproved=false` |
| Unit tests still green | 42/42 on Ichabod after wipe |

**Operator note:** If browser still shows old company name, hit **CLEAN SLATE** or clear site data for `127.0.0.1:18787` (localStorage can keep a prior lead identity).

## FORGEFRONT + SOLAR (ckpt 113) — Justin 2026-09-05

Superseded in branding by ckpt 114. Preserve rule: solar vertical not erased.

## ROSTER LOCK (ckpt 112) — Justin 2026-09-05

| Status | Agents |
|---|---|
| **IN** | Vale Prime, Britt, Caretaker, QRA Sentinel, Public Chat Specialist, **NYX (tip of the sword)**, LOOM, RUNE, ECHO, WAKE Operator, full QRA pack, Sales Hunter (**Tier Zero**), Cluster Core (Loop/Ship/QC/Metrics/Comms) |
| **WLM track** | AETHER = kernel substrate; NYX builds Wake Language Model on it |
| **DEFERRED** | Ronan v.01 (rōnin) — Mesh later, not this wave |
| **PARKED** | All 14 Vanguard/Commercial clusters (kept enabled in registry; not this build wave) |

**Build focus now:** Sales Hunter Tier Zero executor (drafts/pipeline only, never send) + NYX as tip of sword.

## SECURITY HARDENING (ckpt 111)

| Claim | Evidence |
|---|---|
| `/api/deck/bootstrap` discloses `ownerToken` only on same-origin (`Sec-Fetch-Site: same-origin` + matching Origin) | Live `evidence/smoke-security-hardening-*.json` + functional-api GREEN |
| Anonymous scrapers get `ownerToken: null` + `tokenPolicy: same-origin-only` | same |
| Advisory `/api/chat` allows `distribution: public` only (Vale Prime / NYX / owner-only → 403) | same + text-chat-api GREEN |
| Cross-site `/api/commands` still 403; health unauth 401 | same |
| QRA Sentinel refuses empty screen input (no `'mission output clear'` theater) | `mission-orchestrator.js` + focused suite GREEN |
| Phone dumps / `.rdb` / `termux-home.tgz` gitignored under evidence | `.gitignore` |

**Residual (honest):** Loopback same-origin still discloses token to anyone who can load the local deck page (inherent to local operator UX). Sentinel screens structured mission text + objective regex — not a full LLM egress DLP appliance. Lifecycle role stubs still emit durable proof with `EXECUTED` capability notes (not fake ONLINE, but not full Python founder_elite depth yet).

## KEEP MESH / ADD AGENTS (ckpt 110)

| Claim | Evidence |
|---|---|
| Keep built mesh; add design (no rebuild) | Justin order 2026-09-05 |
| Vale Prime sole Miss Vale | `packages/fleet/src/registry.js` `soleMissVale`; fleet-contract GREEN |
| Default path: Vale Prime → Caretaker → QRA org → QRA route (**NYX Apex Coder**) → LOOM → Britt → NYX work → RUNE → Britt assemble → ECHO → Sentinel → Audit | `evidence/smoke-notebook-lifecycle-20260905T034234Z.json` + HTTP `evidence/smoke-vale-nyx-lifecycle-http-20260905T034246Z.json` |
| MEA preserved | mission.evidence stays nyx/rune; auditor-only complete |
| Houston is a label only | ACTIVE_RUN roster rules |

**Residual (honest):** Full IN/OUT agent cut across 65 notebooks still open. NYX schema is on the route (ladder step 1); full NYX upgrade ladder not finished. Remote fabric still env-gated.

## NOTEBOOK §25 DEFAULT PATH (ckpt 109)

Superseded in intent by ckpt 110 (wrong dump §25 was not the bible). Substrate gates remain; NYX routing + Vale Prime naming added in 110.

## FULL FLEET (ckpt 108)

| Claim | Evidence |
|---|---|
| Exhaustive search | Vault `github_wakecodex/.../founder_elite/` holds LOOM/ECHO/Caretaker Python runtimes; mesh had only 6 enabled |
| 28 agents + 14 clusters ONLINE | Live API Lenovo + Ichabod `enabledAgents=28`; `evidence/smoke-full-fleet-live-20260905T025345Z.json` |
| Hot-swap binds | `packages/fleet/src/hot-swap.js` |
| LOOM/ECHO/Caretaker/Sentinel executors | `packages/execution/src/role-capability-executor.js` (Node port of founder_elite contracts + proof) |
| Contract tests | fleet-contract + full-fleet-hot-swap + functional-api GREEN |

## COMMAND DECK (ckpt 107)

| Host | URL | Status |
|---|---|---|
| **Lenovo** | `http://127.0.0.1:5050/` | **LIVE** — readiness 91; `node scripts/start-agent-api.js` |
| **Ichabod** | `http://127.0.0.1:5050/` on box; from Lenovo tunnel `http://127.0.0.1:15050/` | **LIVE** — systemd `athere-titan` → `~/athere-mesh`; host `ichabodcrane` |

**What it is:** Multi-pane operator face (Command / Fleet / Causal river / Proof vault) on the existing Titan owner API. Plain intent → `/api/commands` → proof. Visual language continued from Victory Control; **not** a contest-tracker rebuild.

**Evidence:**
- `evidence/smoke-command-deck-20260905T022529Z.json`
- `evidence/smoke-command-deck-dualhost-20260905T022724Z.json`
- Live inventory via deck API: `mission-ca555a67-f130-4796-a4c2-8ce336a65151` completed
- Lifecycle inventory HTTP: `mission-e67b5349-62a8-4691-ab6e-dc52e0eed644` completed

**Source:** `apps/command-deck/` + static serve in `packages/api/src/titan-api.js`

## PRODUCTION PERFORM ladder

| # | Track | Deliverable | Status |
|---|---|---|---|
| 1 | **Perform** | First human command beyond self-test — inventory + proof | **DONE** — `evidence/smoke-owner-file-perform-20260905T002358Z.json` |
| 2 | **Perform** | Organize named folder by type + proof | **DONE** — same evidence (Desktop `athere-mesh-scratch`, 46 files moved) |
| 3 | **Perform** | Wire `build` Titan (MEA + proof); A→B on Ichabod | **DONE** — Lenovo `evidence/smoke-owner-titan-build-20260905T013334Z.json` (181 files); Ichabod `evidence/smoke-owner-titan-build-ichabod-20260905T013400Z.json` (175 files). NL: `Build Titan now` |
| 4 | **Phones** | Tailscale phone online smoke | **DONE** — `evidence/smoke-phone-tailscale-20260905T002434Z.json` (A15 + kftrwi; mesh Redis PONG) |
| 5 | **Phones / device** | Fleet + **S24 primary phone** | **DONE** — S24 `100.83.225.17`: Redis PONG + SSH `:8022`. Evidence `evidence/smoke-s24-primary-20260905T012844Z.json`. **A15 parked** (cracked screen). |
| 6 | **WLM/NYX** | Schema ladder step 1 in-repo | **DONE** — `packages/nyx/src/nyx-schema.js` + `tests/contract/nyx-schema.test.js` |
| 7 | **UX** | Plain language → perform | **DONE** — inventory/organize/scratch phrases in planner |
| 8 | **Ship** | Commit when Justin orders | WAITING |
| 9 | **Wake/FF data** | Inventory-first (~100GB); no full Lenovo dump | **DONE catalog** — bulk already on Ichabod `/mnt/storage` (**110.0 GB** indexed). Lenovo: `evidence/wake-forgefront-inventory-20260905T014300/` + S24 dump `evidence/s24-dump-20260905T014300/` (~718MB termux tgz). |
| 10 | **Show** | Command Deck on Lenovo + Ichabod | **DONE** — ckpt 107 |
| 11 | **Lifecycle** | NotebookLM §25 default command path | **SUPERSEDED** by ckpt 110 (keep-mesh + agents) |
| 12 | **Design add** | Vale Prime + NYX Apex on default path | **DONE** — ckpt 110 |

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

- **Command Deck:** `http://127.0.0.1:5050/` (Lenovo) · Ichabod local same · Lenovo→Ichabod tunnel `:15050`
- `Inventory my scratch folder` / `Organize my scratch folder by type` / `Build Titan now`
- Fleet: `node scripts/mesh-register-tailscale-fleet.js`
- Deck smoke: `node scripts/smoke-command-deck.js`
- Lifecycle smoke: `node scripts/smoke-notebook-lifecycle.js`

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
107. **Command Deck LIVE** — `apps/command-deck` on owner API; Lenovo `:5050` + Ichabod `:5050` (tunnel `:15050`); dual-host evidence.  
108. **Full fleet ONLINE** — 28 agents + 14 clusters; role executors; residual was NYX→RUNE→Audit-only happy path.  
109. **NotebookLM §25 default path** — Caretaker/QRA/LOOM/Britt/ECHO/Sentinel gates (later corrected: dump §25 was wrong bible).  
110. **Keep mesh / add agents** — Vale Prime sole Miss Vale; QRA route assigns NYX Apex Coder; lifecycle evidence names Vale + NYX; Houston treated as label only.
