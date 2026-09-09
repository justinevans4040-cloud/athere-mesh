# Athere Active Run

**Status:** Active — **FULL FLEET ONLINE** + keep-mesh / add-agents. Backlog **Items 1–24 shipped**. Hostile residual closes **ckpts 126–132** (OPEN_COUNT 0) included. Vale Prime sole Miss Vale. NYX Apex on default path. Command Deck live. Local-only.

**Current state doc:** `docs/current/ATHERE_MESH_TITAN_CURRENT_STATE.md`  
**GitHub repo index (23 repos, company-wide):** `docs/current/GITHUB_ACCOUNT_REPO_INDEX.md`  
**Inventory evidence:** `evidence/github-full-repo-inventory-20260909T202200Z.json`

**ALIGNMENT GATE (HARD — every agent, every thread):**
1. Prefer `origin/master` + this **Status** line over chat summaries and dirty local guesses.
2. **Do not claim “Item 13 next.”** Items 13–24 are already in git history on `master` (`eff20e0` … `7b03529`).
3. If this file’s Status conflicts with `git log origin/master --oneline` for Items 13–24, stop and reconcile before speaking.
4. Current unresolved work is **not** the Phase 0–4 24-item backlog line.

**Current unresolved (honest):**
- Sales Hunter Tier Zero build focus (drafts/pipeline; approved local_outbox send is a capability under Zero — never claim external SMTP)
- Full NYX upgrade ladder (schema step 1 on route; ladder not finished)
- Full IN/OUT agent cut across 65 notebooks
- Remote fabric still env-gated
- Perform ladder **#8 Ship** — handoff/plot lock to GitHub ordered 2026-09-09 (this pass)
- Wake/ForgeFront organize on Ichabod (selective; no 100GB Lenovo dump)
- **Deferred:** Ronan · **Parked:** 14 clusters · **Parked:** A15

**Next:** Justin’s current order only. Do not invent backlog homework.

**Archive (ckpts 1–91):** `archive/runs/ATHERE_ACTIVE_RUN_ckpts_1-91_2026-09-04.md` — **ARCHIVE ONLY** (bannered). Not live next-item.

**Paste tie-in for new threads:** `docs/current/ATHERE_THREAD_TIE_IN.md`

## BACKLOG ITEMS 12–24 — SHIPPED ON MASTER (canonical)

| Item | Commit | Note |
|---|---|---|
| 12 Checkpoints / branching / rollback / quarantine | `9b2dc6d` | Self-heal for Items 1–12 |
| 13 Execution tracing / observability | `eff20e0` | |
| 14 Typed memory | `586111b` | |
| 15–16 State-aware retrieval + Executive Controller | `606094d` | |
| 17–19 Epistemic + model adapter + MCP/A2A (+ 12–19 harden) | `5dd9eb5` | |
| 20–21 Crypto identity + gated experience→learning | `7b811ad` | |
| 22 Validated skill library | `7c1359e` | |
| 23 Self-improvement sandbox (+ HARDEN 22–23) | `f9775f2` | |
| 24 Distributed state layer | `7b03529` | |

Later local ckpts 126–132 are **hostile residual closes on top of that**, not a rewind to “Item 13 next.”

## RED HAT RESIDUAL CLOSE — ZERO PARKING LOT (ckpt 132) — Justin 2026-09-07

**Order:** Close every residual named after the fleet assault.

| Residual | Result |
|---|---|
| I12S1 verified-without-prehash | CLOSED — checkpoint integrity checked before executive/recovery selection |
| I12B1 dead recovery export | CLOSED — removed |
| I12B2 rollback/retry duplication | CLOSED — shared restore path |
| MH-05 missing recovery permission false liveness | CLOSED — classified corrupt, never resumable |
| MH-07 cross-operation budget theater | CLOSED — mutation authorization requires positive `max_state_mutations` |
| MH-08 unauthenticated loopback chat | CLOSED — bearer required |
| MH-09 silent memory-bus publish loss | CLOSED — fail-closed by default; duplicate retries republish |
| MH-10 repeated-interruption idempotency collision | CLOSED — revision-bound recovery operation IDs |
| I12-H05/H06 fact lineage/checkpoint snapshot leaks | CLOSED — ordinary reads redact lineage/snapshots |
| I12-H08 stale artifact revision | CLOSED — proof version bound to completion revision |
| I12-H09 unenforced recovery graph edges | CLOSED — `retry_after` / `rollback_to` path checks |

**Evidence:** `evidence/redhat-residual-close-20260907T163200Z.json` · `scratch/break-redhat-residuals.mjs` **OPEN_COUNT 0** · all prior breaks **OPEN_COUNT 0** · complete repository suite **484 tests / 467 pass / 0 fail / 17 skipped**

**Residual OPEN:** none from ckpts 130–132.

**Next:** Justin’s current order only (Items 13–24 already shipped on `master`).

## RED HAT FLEET ASSAULT — ITEMS 3–12 (ckpt 131) — Justin 2026-09-07

**Order:** Massive no-mercy hostile assault across all code to date. See how it breaks and fix it.

| ID | Severity | Hole | Result |
|---|---|---|---|
| RH-H01 | CRITICAL | Manager/executor resume `blocked` via generic `transition` (bypass checkpoint) | CLOSED |
| RH-H02 | HIGH | Main-line auto-heal picks latest of many CPs (poisonable) | CLOSED — require alternate branch first |
| RH-H03 | HIGH | `create_checkpoint` while blocked captures poison | CLOSED — running only |
| RH-H04 | MEDIUM | Stacked active branches | CLOSED — prior actives quarantined |
| MH-01 | HIGH | Epistemic ops without envelope | CLOSED |
| MH-02 | HIGH | Skill/improvement bind without envelope | CLOSED |
| MH-03 | HIGH | `saveOperation` empty-catch swallows ledger tamper | CLOSED |
| MH-04 | MEDIUM | `inspectRecovery` trusted raw store without ledger verify | CLOSED |
| MH-06 | MEDIUM | Heal soft-masked integrity failures | CLOSED — rethrow corrupt |

**Evidence:** `evidence/redhat-fleet-assault-20260907T160800Z.json` · `scratch/break-redhat-fleet.mjs` **OPEN_COUNT 0** · prior breaks F1–F14 + Item12 still **OPEN_COUNT 0**

**Residual named:** all closed in ckpt 132.

**Next:** Justin’s current order only (Items 13–24 already shipped on `master`).

## ITEM 12 SECURITY / BLOAT / BAD-ACTOR HOSTILE (ckpt 130) — Justin 2026-09-07

**Order:** Hostile audit Item 12 for security bloat and bad-actor holes (asked after capability close). Do not soften.

| ID | Hole | Result |
|---|---|---|
| I12A1 | `create_branch` rewinds diverged **running** work | CLOSED — reject; block first |
| I12A2 | Rollback leaves failed branch **active** | CLOSED — quarantine + `activeBranchId=main` |
| I12A3 | `create_branch` on **completed** → zombie terminal | CLOSED — forbid recovery ops on completed |
| I12A4 | Corrupt ledger aborts **fleet** recovery | CLOSED — isolate into `corrupt`; continue |
| I12B3 | Orchestrator silent `catch {}` on createBranch | CLOSED — soft-fail only on cap/permission/duplicate |

**Evidence:** `evidence/item12-security-bloat-hostile-20260907T154800Z.json` · `scratch/break-item12.mjs` **OPEN_COUNT 0** · `mea-hostile-item12-security.test.js` + Item 12 suites **15/15 GREEN**

**Superseded by:** ckpt 131 Red Hat fleet assault.

**Residual named:** all closed in ckpt 132.

## ITEM 12 CHECKPOINTS / BRANCHING / ROLLBACK / QUARANTINE (ckpt 129) — Justin 2026-09-07

**Order:** Execute backlog Item 12. No rebuild. Leave nothing behind.

| Gate | Result | Evidence |
|---|---|---|
| Acceptance | Mid-mission failure recovers without full restart | `mission-checkpoints-item12.test.js` e2e + orchestrator auto-heal |
| Hole closed | Checkpoint restores facts/claims/bindings (not only work partitions) | `mea-hostile-item12-gaps.test.js` |
| Hole closed | `createBranch` forks live state to checkpoint (not metadata-only) | same |
| Hole closed | Auto-heal retries from **branch origin** checkpoint | same + recovery-coordinator |
| Hole closed | Branch hard cap 32 | `MAX_BRANCHES` |
| Hole closed | Orchestrator opens alternate branch before heal | `blockThenHeal` |
| Break script | **OPEN_COUNT 0** | `evidence/item12-checkpoints-branching-20260907T090000Z.json` |

**Superseded security gate:** ckpt 130 (security/bloat/bad-actor).

**Next:** Justin’s current order only (Items 13–24 already shipped on `master`).

## F5–F14 CLOSE — NO PARKING LOT (ckpt 128) — Justin 2026-09-06

**Order:** Close every residual. Leave nothing behind. OPEN_COUNT must be zero.

| ID | Hole | Result |
|---|---|---|
| F5 | Empty-permissions recovery bypass | CLOSED — explicit recovery permission required |
| F6 | Envelope timeout / budget unused | CLOSED — enforced on `authorizeAgentOperation` (service clock) |
| F7 | Fact ops without envelope | CLOSED — envelope required on all fact mutations |
| F8 | Bridge store no FS serialization | CLOSED — keyed lock on bridge `saveMission` |
| F9 | Windows lock PID-reuse | CLOSED — Windows start-ticks identity on locks |
| F10 | Pre-ledger import integrity theater | CLOSED — cannot certify import-rooted ledger; `integrityBound` on verify |
| F11 | Proof payload ≠ completedWork | CLOSED — complete path + QR18 L6 bind payload work |
| F12 | verification_gate id-regex | CLOSED — explicit `verificationGate` only; open gate fails path |
| F13 | Item 12+ surfaces “bloat” | CLOSED — surfaces retained; recovery cannot emit `completed` |
| F14 | select facts leak lineage | CLOSED — `select(currentFacts)` strips supersession fields |

**Evidence:** `evidence/f5-f14-close-20260906T234500Z.json` · `scratch/break-f5-f14.mjs` **OPEN_COUNT 0** · F1–F4 rebreak still **OPEN_COUNT 0** · focused suite **50/50 GREEN**

**Residual OPEN:** none from the Phase 1–3 hostile list.

## F1–F2–F4 SIBLING CLOSE (ckpt 127) — Justin 2026-09-05

**Order:** Leave nothing behind on F1/F2/F4. Repair and try to break it.

| Sibling | Result | Evidence |
|---|---|---|
| F1 forged / wrong-byte artifacts | REJECT; honest complete ACCEPT_OK | `evidence/f1-f2-f4-sibling-close-20260905T180500Z.json` |
| F2 empty `{}` / boolean-only / whitespace evidence as performers | REJECT_OK | same + `evidenceEntryHasSubstance` |
| F4 tamper on get/recovery/fact/select/history/reconstruct/memory/authorityFor | REJECT on all | `assertLoadedLedgerIntact` on every load path |
| Break script | **OPEN_COUNT 0** (16 attacks) | same evidence |
| Focused suite | **49/49 GREEN** | reaudit + item12 + MEA/orchestrator/state/QR18 |

**Superseded by ckpt 128:** F5–F14 closed (no parking lot).

## PHASES 1–3 HOSTILE AUDIT — CRITICAL/HIGH CLOSES (ckpt 126) — Justin 2026-09-05

**Order:** Hostile audit Phases 1–3 (Items 3–11) for bloat / weak / theater / security. Do not soften the audit.

| Hole | Severity | Result | Evidence |
|---|---|---|---|
| F1 forged `artifactReferences` complete | CRITICAL | CLOSED — proof-store `verifyArtifactProof` on `completed` | `evidence/phase1-3-hostile-audit-20260905T214500Z.json` |
| F2 noop executor heartbeat = performer | HIGH | CLOSED — evidence-write-only `recordedWorkPerformers` | same |
| F4 tampered ledger loads until opt-in verify | HIGH | CLOSED — verify on `transition` load + `get()` | `mea-hostile-phase1-3-ledger-tamper.test.js` |

**Residual OPEN (MEDIUM/LOW — closed in ckpt 128):** F5–F14 — see ckpt 128. No parking lot.

## ITEM 11 WORKFLOW GRAPHS — FAILED-SKIP CLOSED (ckpt 125) — Justin 2026-09-05

**Order:** Execute backlog Item 11 — explicit workflow/plan graphs. No rebuild.

| Gate | Result | Evidence |
|---|---|---|
| Acceptance | Execution must remain on a valid mission path | `assessMissionPath` / `assertValidMissionPath` on work-partition mutations |
| Hole closed | Failed intermediate cannot waive plan-order for earlier incomplete steps | `evidence/item11-workflow-failed-skip-20260905T135300Z.json` |
| Focused suite | **32/32 GREEN** | workflow + Item 10/11 reaudit + new fail-skip tests |

**Production:** `packages/contracts/src/workflow-graph.js`. QR18 legacy L5 aligned. Item 12 closed in ckpt 129.

## ITEM 10 QR18 LAYERED — LEVEL 1 LEDGER GATE (ckpt 124) — Justin 2026-09-05

**Order:** Execute backlog Item 10 — layered QR18. No rebuild.

| Gate | Result | Evidence |
|---|---|---|
| Acceptance | Completion claims traceable to evidence + verifier (Levels 1–6) | `evaluateQr18Layers` on every `completed` transition |
| Hole closed | Level 1 requires **recorded work performers**; planted evidence alone REJECT; `Set.length` bug fixed | `evidence/item10-qr18-level1-ledger-20260905T134606Z.json` |
| Focused suite | **21/21 GREEN** | same evidence |
| Service path | clear evidence → complete still L1 via ledger `nyx` | `mea-hostile-item10-level1-ledger.test.js` |

**Production:** `packages/proof/src/qr18-layered-verification.js`. (Item 11 closed in ckpt 125.)

## ITEM 9 MEA — VACUUM CERT CLOSED (ckpt 123) — Justin 2026-09-05

**Order:** Backlog Item 9 — worker cannot also mark the job done. No rebuild.

| Gate | Result | Evidence |
|---|---|---|
| Acceptance | Performer ≠ sole success authority on mission-state path | `authorizeCompletedWorkClaim` + ledger `recordedWorkPerformers` |
| Hole closed | Auditor cannot certify with **zero** recorded work performers | `evidence/item9-mea-vacuum-cert-20260905T132234Z.json` |
| Focused MEA suite | **26/26 GREEN** | same evidence `focusedSuite` |
| Hostile probe | vacuum / executor / manager / The Britt 4.0 / Sales Hunter / QRA Sentinel / recovery REJECT; honest nyx→auditor ACCEPT | `scratch/mea-item9-hostile-probe.mjs` |

**Production:** `packages/contracts/src/execution-roles.js` — reject success certification when `recordedWorkPerformers` is empty (after independence / same-update checks).

**Docs:** `docs/current/ATHERE_MANAGER_EXECUTOR_AUDITOR.md` updated. (Items 10–11 closed in later ckpts.)

## COMMAND DECK UP + SALES HUNTER → FORGEFRONT (ckpt 121) — Justin 2026-09-05

**Order:** Bring Command Deck up first, then wire Sales Hunter to ForgeFront.

| Surface | URL | Evidence |
|---|---|---|
| Lenovo Command Deck | `http://127.0.0.1:5050/` | `evidence/smoke-command-deck-up-20260905T122712Z.json` — health ready, 28 agents |
| Ichabod Deck (tunnel) | `http://127.0.0.1:15050/` → Ichabod `:5050` | same dual-tunnel session |
| ForgeFront (tunnel) | `http://127.0.0.1:18787/` → Ichabod `:8787` | Solar + `/pm` |
| Sales Hunter T0 → CRM | merges non-DQ pipeline into ForgeFront `/api/state` `solarSales.leads` | `evidence/smoke-sales-hunter-forgefront-20260905T123011Z.json` |

**Wire:** `packages/execution/src/sales-hunter-executor.js` optional `forgeFrontBaseUrl`; role path needs `FORGEFRONT_SALES_HUNTER_INGEST=1` + `FORGEFRONT_API_URL` (prevents test/env CRM leaks).

## SALES HUNTER TIER ZERO — NEXT CAPABILITY (ckpt 122) — Justin 2026-09-05

**Correction:** Tier Zero = highest roster class (not a starter rung). “Next tier” = next *capability under Zero*: past drafts-only.

| Capability | Behavior | Evidence |
|---|---|---|
| `hunt_outbound` | pipeline + drafts + CRM ingest | prior T0 smokes |
| `outreach_send` | requires `humanApproved:true` + **exactly one** `leadId`; local outbox + CRM `FOLLOW_UP` | `evidence/smoke-sales-hunter-approved-send-20260905T125158Z.json` |
| `phone_call` | still **denied** | same evidence `phoneStillDenied: true` |

Transport is **local_outbox** (offline-first). Does not claim external SMTP/API send.

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
