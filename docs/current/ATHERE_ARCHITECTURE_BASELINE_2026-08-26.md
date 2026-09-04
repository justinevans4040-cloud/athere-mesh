# Athere Architecture Baseline — 2026-08-26 (refreshed 2026-09-05)

**Status:** CURRENT architecture baseline for modification-backlog Phase 0 / Item 1  
**Repository:** `justinevans4040-cloud/athere-mesh`  
**Default branch:** `master`  
**Purpose:** freeze the observed Athere/Titan architecture so another engineer can reconstruct current Athere without chat history.

This document separates what exists in executable repository code from what is partial, experimental, proposed, or deprecated. Conversational model output is advisory only. Prefer `runtime/ATHERE_ACTIVE_RUN.md` for live checkpoint status.

## 1. Current system boundary

Athere is a **centralized Titan mission-command runtime** with evidence-bound mission completion, Manager/Executor/Auditor separation, and optional offline-first mesh fabric (Redis resonance bus, shared Postgres mission store, remote work queue). The runtime is Node.js ESM (`node >=24`, `pnpm`) organized as small packages under `packages/`.

Current operating flow:

1. ordinary-language command enters Titan's loopback API;
2. command planner maps supported intent to a deterministic executor path;
3. durable mission is created and revisioned through Mission State Service;
4. role-bound agents perform work; auditor alone certifies success;
5. transitions persist with operation-ID idempotency and hash-chained history;
6. completion requires verified proof + layered QR18 Level 1–6 evidence;
7. interrupted/blocked missions surface for recovery; executive `decideNext` advises strategy (orchestrator applies recovery strategy changes).

Authoritative references: `STATUS.md`, `docs/current/TITAN.md`, `runtime/ATHERE_ACTIVE_RUN.md`, repository code, tracked tests, frozen evaluation controls under `evaluations/controls/`.

## 2. Status classification

### Implemented (backlog Items 2–24 landed in code; see ACTIVE_RUN for evidence boundaries)

#### Titan mission command

- Loopback owner API: `packages/api/src/titan-api.js`
- Command planning: `packages/command/src/command-planner.js`
- Mission orchestration: `packages/orchestrator/src/mission-orchestrator.js` (consults executive `decideNext` on failure)
- Agent execution: `packages/agent/src/agent-runtime.js`
- Deployable user service: `deploy/systemd-user/athere-titan.service`

#### Mission state and transitions (Items 3–5, 8)

- Contracts: `packages/contracts/src/mission.js`
- Mission State Service: `packages/mission/src/mission-state-service.js`
- Filesystem store: `packages/mission/src/mission-store.js`
- Semantic fact ops: `recordFact` / `supersedeFact` / `correctFact` / `revokeFact` (raw fact-array replacement rejected)
- Operation-ID idempotency across state-changing ops: `docs/current/ATHERE_IDEMPOTENT_OPERATIONS.md`
- States: `accepted`, `running`, `blocked`, `completed`

#### Evidence / proof / QR18 (Items 6, 10)

- Proof store + artifact provenance: `packages/proof/`
- Layered QR18 Level 1–6: `packages/proof/src/qr18-layered-verification.js`

#### Manager / Executor / Auditor (Item 9)

- Role taxonomy + structural independence: `packages/contracts/src/execution-roles.js`
- Docs: `docs/current/ATHERE_MANAGER_EXECUTOR_AUDITOR.md`
- Executors cannot advance `completedWork` or emit `completed`; auditor certifies; performer ≠ certifier via ledger actors

#### Evaluation harness (Item 2)

- Harness: `packages/evaluation/src/evaluation-harness.js`
- Frozen control: `evaluations/controls/titan-core-v2-42b3a4fc8a85.json`
- Canonical SHA-256: `08f56024a5b4be47c3e8edcd1c48aa7dc2388785392233178d1bb0631b254498`
- CLI: `pnpm evaluation:collect-control`, `pnpm evaluation:compare`

#### Workflow / checkpoints / observability (Items 11–13)

- Plan graphs, checkpoints/branches, recovery heal paths
- Observability traces: `docs/current/ATHERE_OBSERVABILITY_TRACING.md`

#### Memory (Items 14–15)

- Typed memory + state-aware retrieval: `packages/memory/`, `docs/current/ATHERE_TYPED_MEMORY.md`

#### Executive + epistemic (Items 16–17)

- Executive controller: `packages/executive/src/executive-controller.js`
- Wired into mission service + orchestrator failure path
- Epistemic claims: `docs/current/ATHERE_EPISTEMIC_UNCERTAINTY.md`

#### Model / protocol adapters (Items 18–19)

- Model adapter + MCP/A2A interop: `packages/interop/`, related docs

#### Identity (Item 20)

- Cryptographic agent identity registry: `packages/identity/`
- Docs: `docs/current/ATHERE_AGENT_IDENTITY.md`

#### Learning / skills / self-improvement (Items 21–23)

- Gated learning (harness-backed compare/measure): `packages/learning/`
- Validated skill library: `packages/skills/`
- Self-improvement sandbox: `packages/improvement/`

#### Distributed state layer (Item 24)

- Primary + replicas + event stream: `packages/distributed/`
- Optional durable replica directory for cross-process capacity reads
- Primary remains sole writer; replicas never authoritative
- Docs: `docs/current/ATHERE_DISTRIBUTED_STATE.md`
- Not claimed: geo dual-primary, CRDT authority merge, automatic failover

#### Operational agent set

Enabled executors from `packages/fleet/src/registry.js` include Miss Vale Prime, Agent Vale, NYX, RUNE, QRA Audit Evidence Strike, QRA Recovery Driver. Caretaker, LOOM, ECHO, Cluster QC Sentinel, QRA Sentinel remain agents (not demoted to jobs). Authority chain: founder Justin Evans → Miss Vale Prime → The Britt 4.0; `qra_sentinel` is output Governor.

#### Mesh fabric (doctrine baseline blockers — transport/state/dispatch)

- Redis resonance bus: `packages/resonance/src/redis-resonance-bus.js` (cross-host proven; orchestrator defaults to memory bus)
- Shared Postgres mission store adapter: `packages/postgres/`
- Remote work queue / dispatch: `packages/execution/`

### Partially implemented / bounded

- Doctrine baseline loop Agent A → Agent B zero-human is **not** fully closed as a single product path (transport, shared state, and remote dispatch exist as pieces).
- Item 24 physical distribution is durable-replica + shared-primary composition, not full geo consensus.
- Ubuntu Ollama loopback hardening remains unresolved until fresh host evidence.
- Custom injectable `store` remains trusted composition (documented residual).

### Experimental / optional

- PGlite/Postgres adapters; Redis/Tailscale fabric when env-configured
- `future-integrations/` candidates are not runtime dependencies
- Historical Nosana/Arweave evidence under `evidence/` is historical only

### Proposed / not current claims

Anything in `research/ATHERE_MESH_MODIFICATION_BACKLOG_2026-08-25.md` not listed above as implemented must not be treated as live capability without ACTIVE_RUN evidence.

### Deprecated / historical

- `archive/iterations/**` is historical
- Old brochure/demo slices are not proof of present capability

## 3. Component map

| Layer | Implementation | Authority |
|---|---|---|
| Athere | product/architecture docs | thesis / boundaries |
| Titan | API + command + orchestrator + executors | mission command spine |
| Mission State Service | `packages/mission/` | authoritative mission mutations |
| Contracts | `packages/contracts/` | legal transitions, MEA, envelopes |
| Proof / QR18 | `packages/proof/` | completion evidence |
| Evaluation | `packages/evaluation/` + `evaluations/controls/` | measured improvement claims |
| Executive | `packages/executive/` | advisory strategy |
| Identity / Learning / Skills / Improvement | respective packages | gated knowledge + identity |
| Distributed | `packages/distributed/` | optional replica capacity |
| Resonance / Postgres / Remote execution | respective packages | optional mesh fabric |
| Fleet | `packages/fleet/` | agent registry |
| Recovery | `packages/recovery/` | interrupted-mission recovery |

## 4. Storage and state authority

**Authoritative (functional default):** filesystem mission + proof under Titan runtime root; hash-chained transition history; operation-ID ledger.

**Optional shared authority:** Postgres mission store with revision CAS (single writer).

**Non-authoritative:** model chat context; replica snapshots (`authoritative: false`); advisory executive decisions until applied through recovery/MEA paths.

## 5. Network and deployment topology

```text
Operator/client
   |
   | authenticated local request
   v
127.0.0.1:5050 (Titan API on Ichabod)
   |
   +--> command planner
   +--> mission orchestrator (+ executive decideNext on failure)
   +--> enabled deterministic executors (local or remote work queue)
   +--> mission store (filesystem default; optional Postgres / distributed wrapper)
   +--> proof store
   +--> optional Redis resonance bus (seed-guarded)
   +--> advisory local Ollama (chat only)
```

Redis/Tailscale and shared Postgres are optional; hermetic tests stay offline.

## 6. Benchmark / verification evidence

- Frozen self-covering control `titan-core-v2-42b3a4fc8a85` — SHA-256 `08f56024a5b4be47c3e8edcd1c48aa7dc2388785392233178d1bb0631b254498`
- Historical functional slice proofs remain in `STATUS.md` / `docs/current/TITAN.md` (do not substitute for Item 2 comparative claims)
- Live suite counts evolve; always re-run `corepack pnpm test` rather than trusting an old total in this file

## 7. Known failure modes and boundaries

1. Incomplete executor coverage for many recovered registry agents
2. Single-writer assumption for mission authority (distributed replicas do not write)
3. Independence is mission-scoped ledger actors, not per-subgoal attribution
4. Pre-ledger imported missions have empty performer sets
5. Network bus publish fail-closed only when bus sets `failClosedOnPublish`
6. Ollama loopback confinement not claimed without fresh host evidence
7. Learning measure requires Item 2 harness `improvement_proven` vs frozen control
8. No geo dual-primary / CRDT mission authority

## 8. Reconstruction checklist

1. Read `runtime/ATHERE_ACTIVE_RUN.md` and `STATUS.md`
2. Read this baseline and `research/ATHERE_MESH_MODIFICATION_BACKLOG_2026-08-25.md`
3. Read `docs/current/TITAN.md`, MEA, idempotency, and evaluation harness docs
4. Inspect `package.json` (Node >=24)
5. Inspect mission contracts, mission-state-service, orchestrator, execution-roles
6. Inspect frozen control under `evaluations/controls/` and verify SHA-256
7. Run `corepack pnpm test`
8. Optionally run Redis/Postgres/remote smokes only when env seeds are configured
9. Compare claims to ACTIVE_RUN evidence — do not invent completion from conversation

## 9. Backlog status after this baseline

Item 1 acceptance: another engineer can reconstruct current Athere from repository docs + code without chat history.

Later items are implemented in code as summarized above; **do not** treat any item as acceptance-complete without ACTIVE_RUN hostile-audit evidence for that item's acceptance condition.
