# Athere Active Run

**Status:** Active — Items 2–24 landed; full-authority production close **in progress** (ordered 1–9). Dirty tree ship is ckpt 93.

**New-thread tie-in (paste block):** `docs/current/ATHERE_THREAD_TIE_IN.md` — continue only; zero skill load = deletion; no rebuild.

**Full checkpoint archive (ckpts 1–91):** `archive/runs/ATHERE_ACTIVE_RUN_ckpts_1-91_2026-09-04.md`

This file is the live operator view for the current Athere implementation run.

## Current run

- State: Authority chain locked per founder Justin Evans: founder → Miss Vale Prime → The Britt 4.0 for dangerous keys; `qra_sentinel` is last-line output Governor with blast radius; `cluster_core_qc_sentinel` remains daily QC only. See `docs/current/ATHERE_AUTHORITY_AND_SENTINEL.md` and `packages/contracts/src/authority-chain.js`.
- Current focus: **Full authority ladder (1–9)** — ship → Ichabod sync → HTTP A→B → shared proofs → Tailscale Postgres → live 17 skips → mission-hash skills/improvements → store brand → pre-ledger fail-closed.
- Orchestrator publish-error swallow residual **closed** for network buses: Redis bus sets `failClosedOnPublish: true`; env auto-wire injects that bus when `ATHERE_MESH_REDIS_*` is set.

- **MEA independence (structural).** `authorizeCompletedWorkClaim` uses the mission's hash-chained `transitionHistory` only — no caller payload content. `recordedWorkPerformers` = ledger actors of non-empty evidence writes or recorded executor actions. Certifier rejected if in that set or if the same transition writes work evidence. Signal↔envelope bind, role taxonomy, plan-covering `completedWork`, and recovery gates unchanged. Payload games (base64, URI, homoglyphs, bags, depth, etc.) are **IRRELEVANT**.

- **Kept acceptance pins:** `mea-structural-provenance`, signal↔envelope mismatch, same-update self-cert, completed bypass / failedWork, item harden suites. Retired scrape-channel re-audit files deleted (coverage lives in structural suite).

- **Documented residuals (closing under full-authority order):**
  - A→B: HTTP `/api/commands` cross-host not smoked; proofs owner-local FS; Postgres tunnel-bound; worker checkout may lag Lenovo HEAD.
  - Custom `store` remains trusted composition; Item 24 replicas are capacity reads (no geo/CRDT/failover — design ceiling, not this ladder).
  - Skills/improvements process-local (mission-hash deferred until this ladder).
  - Pre-ledger imported missions have empty performer sets (legacy).
  - `artifactReferences` / observations / fact ops are not performance; evidence clear is not a work write; independence is mission-scoped.

- **Last green A→B smoke:** `evidence/smoke-owner-api-mission-crosshost-20260904T214254.json` — mission `mission-7c820439-59e8-45b5-bc3f-d851911ae666` rev 7 `completed`.

## Checkpoint history

Live history starts at ckpt 92. Older checkpoints: `archive/runs/ATHERE_ACTIVE_RUN_ckpts_1-91_2026-09-04.md`.

92. **Repo bloat cleanup (ordered 1–4).**

- **ACTIVE_RUN:** ckpts 1–91 archived; this file truncated to live head.
- **MEA:** deleted 8 superseded scrape-channel hostile files. Kept structural + signal↔envelope + same-update + completedWork/failedWork + item harden pins.
- **Demos:** untracked `evidence/demos/*.mp4` from git (remain on disk locally; gitignored).
- **Smoke:** deleted failed `…214146.json`; green `214254` kept.
- **Evidence:** kept MEA pins 11/11; full suite **412 pass / 0 fail / 17 skip** (hermetic).

93. **Full-authority production close started (ordered 1–9).**

- **Ship:** commit + push ckpts 87–92 work (WeakSet brands, HIGH gaps 1/2/16/21/24, boot recovery, smoke evidence, bloat cleanup) to `origin/master`.
- Remaining ladder: Ichabod sync, HTTP `/api/commands` smoke, shared proofs, Tailscale Postgres, live 17 skips green, mission-hash skills/improvements, store brand, pre-ledger fail-closed.
