# Athere Architecture Baseline — 2026-08-26

**Status:** CURRENT architecture baseline for modification-backlog Phase 0 / Item 1  
**Repository:** `justinevans4040-cloud/athere-mesh`  
**Default branch:** `master`  
**Purpose:** freeze the observed Athere/Titan architecture before the research-driven redesign backlog advances.

This document separates what exists in executable repository code from what is partial, designed, experimental, proposed, or deprecated. It intentionally does not promote future architecture into current-state claims.

## 1. Current system boundary

Athere is presently implemented as a **centralized Titan mission-command runtime** with evidence-bound mission completion. The current runtime is Node.js ESM (`node >=24`, `pnpm 11.9.0`) and is organized as small packages under `packages/` rather than as a distributed autonomous mesh.

The current operating flow is:

1. ordinary-language command enters Titan's loopback API;
2. the command planner maps supported intent to a deterministic executor path;
3. a durable mission is created and revisioned;
4. enabled role-bound agents/executors perform the supported work;
5. mission transitions are persisted;
6. completion requires a verified proof reference with a SHA-256 hash;
7. interrupted missions are surfaced for recovery rather than silently treated as complete.

Authoritative current-state references are `STATUS.md`, `docs/current/TITAN.md`, repository code, tracked tests, and stored proof/evidence artifacts. Conversational model output is advisory only.

## 2. Status classification

### Implemented

#### Titan mission command

- Loopback owner API in `packages/api/src/titan-api.js`.
- Plain-language command planning in `packages/command/src/command-planner.js`.
- Mission orchestration in `packages/orchestrator/src/mission-orchestrator.js`.
- Agent execution boundary in `packages/agent/src/agent-runtime.js`.
- Deployable user service in `deploy/systemd-user/athere-titan.service`.

#### Mission state and transitions

- Mission contract in `packages/contracts/src/mission.js`.
- Current states: `accepted`, `running`, `blocked`, `completed`.
- Illegal transitions are rejected.
- Completion is rejected unless a proof object is verified and contains a lowercase SHA-256 digest.
- Durable filesystem mission snapshots are implemented by `packages/mission/src/mission-store.js`.
- Snapshots carry monotonically checked revisions and are written through guarded lock/temporary-file mechanics.
- Stale lock reclamation checks hostname, PID, token, lease metadata, and on Linux may use boot ID plus process-start ticks.

#### Evidence / proof

- `packages/proof/src/proof-store.js` canonicalizes proof payloads, writes mission proof files, calculates SHA-256, and verifies stored bytes against the referenced hash.
- Proof references are constrained to `proofs/<mission-id>.json` under the configured runtime root.
- Stored proof is required for the currently implemented completion path.

#### Operational agent set

The registry preserves founder-assigned agent identities. Only agents with real executor bindings are currently `enabled` for live execution. Current enabled set from `packages/fleet/src/registry.js`:

| Agent | Executor ID | Current responsibility |
|---|---|---|
| Miss Vale Prime | `mission-supervisor` | mission supervision |
| Agent Vale | `ollama-chat` | advisory model chat |
| NYX | `repository-inspector` | deterministic repository inspection |
| RUNE | `node-test-runner` | direct Node test execution |
| QRA Audit Evidence Strike | `proof-verifier` | proof/evidence validation |
| QRA Recovery Driver | `recovery-coordinator` | interrupted-mission recovery state |

Caretaker, LOOM, ECHO, and Cluster QC Sentinel remain agents. Absence of an executor binding must not demote them out of the agent registry. `validateOperationalFleet()` rejects an enabled agent that lacks an executor ID.

#### Recovery

- Recovery coordinator exists in `packages/recovery/src/recovery-coordinator.js`.
- Startup/recovery behavior is test-covered under `tests/integration/recovery-coordinator.test.js` and mission-store integration tests.
- Current recovery scope is bounded recovery of interrupted/corrupt mission records, not full persisted branch/rollback semantics.

#### API authentication and admission boundary

Per the current Titan contract:

- API listener is intended to remain loopback-bound.
- Protected command, mission, and chat requests require `TITAN_API_BEARER_TOKEN`.
- Cross-site browser request metadata/origins are rejected as defense in depth.
- Execution requests are not allowed through the advisory chat endpoint.
- Command execution is serialized; concurrent command admission can be rejected with `429`.

#### Test surfaces

Tracked executable test areas currently include:

- contract tests for mission, policy, fleet, agent runtime, Ollama client, service behavior, and plain-language command planning;
- integration tests for the API, mission orchestration, mission store, proof integrity, recovery, Postgres adapters, resonance bus, node-test executor, and text chat;
- a performance test for mission transitions;
- end-to-end functional smoke script in `scripts/smoke-functional-team.js`.

### Partially implemented

#### External authoritative mission state

A durable mission store exists outside model context, and mission revision checks already prevent simple silent overwrite. However, Athere does **not yet** have the full dedicated Mission State Service required by backlog Item 3. Current mission snapshots do not yet own the complete proposed mission model of goals, subgoals, dependency graph, permissions, active-agent allocation, environment observations, artifact lineage, and current plan.

#### Versioned state-transition history

Mission snapshots have revision semantics and append signal history, but they are not yet the complete transition ledger described by backlog Item 4. The current system does not yet persist every important mutation as a first-class record with previous version, actor, action, authorization, verifier, evidence, content hashes, and rollback target.

#### Evidence provenance

Current proof files are content-hashed and mission-bound. They do not yet provide the complete artifact lineage model required by backlog Item 6, including artifact IDs, predecessor hashes, producer action, verifier decision, and associated mission-state version for every consequential artifact.

#### Agent protocol/schema enforcement

The runtime has deterministic JavaScript contract validation for missions, policies, fleet entries, API inputs, and executor boundaries. It does not yet implement the universal typed agent envelope proposed by backlog Item 7, and it does not currently use Zod as a universal inter-agent protocol.

#### Manager / Executor / Auditor separation

The runtime enforces Manager / Executor / Auditor roles for operational agents on the authoritative mission transition path. Executors may record evidence but cannot advance `completedWork` or emit `completed`; only the auditor may certify subgoal success and mission completion (still proof-gated). See `docs/current/ATHERE_MANAGER_EXECUTOR_AUDITOR.md`. Layered QR18 Level 1–6 verification remains backlog Item 10.

#### Durable storage options

- Filesystem mission/proof persistence is the current functional acceptance path.
- `packages/postgres/` provides optional Postgres/PGlite adapters and smoke coverage.
- Postgres is not currently the mandatory authoritative production state backend.

#### Resonance / Redis fabric

- `packages/resonance/src/resonance-bus.js` and current architecture documents preserve the typed-signal/Redis-fabric direction.
- Redis RAM-pool evidence and historical smoke artifacts exist under `evidence/`.
- The current Titan functional acceptance path does not require the S24 Redis node.
- S24/Redis reintegration is explicitly pending operator-side infrastructure work.

### Designed but not implemented

The following are present as architecture/backlog direction but are not complete production capabilities in the current runtime:

- dedicated Mission State Service with complete mission authority;
- explicit supersession/revocation/correction lineage for authoritative facts;
- universal typed agent envelope across all agent operations;
- operation-ID idempotency and universal duplicate suppression;
- layered QR18 Level 1–6 verification model;
- persisted workflow/plan graph with dependency, retry, rollback, supersession, and alternate-path edges;
- verified checkpoints, mission branching, failed-branch quarantine, and arbitrary rollback;
- complete machine-readable observability trace including model/tool cost and token accounting;
- working/episodic/semantic/procedural/artifact/state-history memory separation;
- state-aware memory retrieval;
- Executive Controller;
- explicit uncertainty/confidence state;
- universal model/agent adapter layer;
- MCP/A2A interoperability layer;
- cryptographic identity/capability boundary for every agent;
- gated continual-learning pipeline;
- validated skill library;
- self-improvement sandbox;
- distributed authoritative state layer.

### Experimental / optional

- Postgres/PGlite adapters under `packages/postgres/`.
- Redis/Tailscale hot-memory and Resonance Bus deployment work represented by current docs and prior smoke evidence.
- `future-integrations/rucelium/` is retained as a future integration candidate and is not part of the current Titan runtime.
- Historical Nosana and Arweave evidence under `evidence/` documents prior integration experiments, not current mandatory runtime dependencies.

### Proposed

The ordered redesign in `research/ATHERE_MESH_MODIFICATION_BACKLOG_2026-08-25.md` is proposed architecture unless an item is explicitly classified above as implemented or partial. In particular, continual learning, controlled self-improvement, and distributed state must not be treated as current Athere capabilities.

### Deprecated / historical

- `archive/iterations/**` is historical reconstruction/provenance material and is not the current runtime.
- Old brochure/demo slices and historical dev/UI language must not be used as proof of present capability.
- The original pre-loss Titan machine is not present; current Titan is a reconstruction.
- Disabled recovered agents/clusters in `packages/fleet/src/registry.js` are registry knowledge, not operational executors.

## 3. Component map

| Layer | Current implementation | Authority / role |
|---|---|---|
| Athere | architecture/product layer documented in `docs/ARCHITECTURE.md` and `docs/current/DIRECTION.md` | system thesis and boundaries |
| Titan | API + command + orchestrator + executor packages | mission command spine |
| Mission contracts | `packages/contracts/src/mission.js` | legal state transition rules |
| Mission persistence | `packages/mission/src/mission-store.js` | current durable mission snapshots/revisions |
| Proof | `packages/proof/src/proof-store.js` | content-bound completion evidence |
| Fleet | `packages/fleet/src/registry.js` | recovered identities plus enabled executor bindings |
| Recovery | `packages/recovery/src/recovery-coordinator.js` | bounded interrupted-state recovery |
| Resonance | `packages/resonance/src/resonance-bus.js` | typed signal transport abstraction |
| Postgres | `packages/postgres/` | optional durable adapter, not mandatory current authority |
| Ollama | `packages/agent/src/ollama-client.js` | advisory local-model path for Agent Vale |
| Deployment | `deploy/systemd-user/athere-titan.service` | single user-service runtime on Ichabod |

## 4. Current storage and state authority

### Authoritative for the current functional runtime

- filesystem mission snapshots under the configured Titan runtime root;
- filesystem proof artifacts under that same root;
- repository-tracked source, contracts, tests, deployment unit, and evidence documentation.

### Non-authoritative / advisory

- model conversation context;
- advisory Ollama chat responses;
- disabled fleet registry entries;
- historical archive/demo documents;
- unverified operator recollection without corresponding repository/runtime evidence.

### Optional / pending integration

- Postgres/PGlite mission persistence;
- Redis/Tailscale hot-memory fabric.

## 5. Network and deployment topology

Observed current deployment contract:

```text
Operator/client
   |
   | authenticated local request
   v
127.0.0.1:5050 on Ichabod
   |
   v
Titan API
   |
   +--> command planner
   +--> mission orchestrator
   +--> enabled deterministic executors
   +--> filesystem mission store
   +--> filesystem proof store
   +--> advisory local Ollama path (chat only)
```

Current `docs/current/TITAN.md` records the managed runtime root as `/home/the_founder/athere-titan-reconstruction` with `athere-titan.service` enabled as a user service. The same document records the listener as `127.0.0.1:5050`.

Redis/Tailscale nodes are not required for this current central acceptance path. Ubuntu Ollama loopback hardening remains an explicitly unresolved deployment boundary until fresh service/listener/API evidence proves it.

## 6. Current benchmark / verification evidence

The most recent repository-recorded live verification in `STATUS.md` and `docs/current/TITAN.md` states:

- merged-master / Ichabod suite: **109/109 passed**;
- live functional mission persisted through service restart;
- stored revision/status after restart: revision `5`, `completed`;
- stored result: `109` passed, `0` failed;
- proof SHA-256 independently recomputed as `3c0c9b5885b95cad55de5a193c46494cb6711735137a23ed510426ec5301aa17`;
- six enabled agents;
- zero recovered/blocked/corrupt startup records at that verification point.

These are frozen historical verification facts from the 2026-08-23/24 functional slice. They are **not** a substitute for the permanent evaluation/regression harness required by backlog Item 2.

## 7. Known current failure modes and boundaries

1. **Incomplete executor coverage.** Most recovered agents and all fleet clusters remain disabled because no production executor is bound.
2. **Single-service writer assumption.** Mission stale-lock takeover uses an in-process keyed guard; the deployment contract therefore assumes one managed Titan service and explicitly rejects an unmanaged second writer.
3. **No universal idempotency key.** Mission revision control prevents some duplicate/conflicting writes, but there is no universal operation-ID ledger for every state-changing action.
4. **No full state lineage.** Current revision/signal history does not yet supply arbitrary supersession, revocation, predecessor hashing, or rollback semantics.
5. **No permanent evaluation harness.** Existing unit/integration/performance tests and smoke evidence are strong regression assets but do not yet measure the full research backlog metrics or statistical noise floor.
6. **No universal layered QR18.** Current proof verification is real but narrower than the proposed six-level verification hierarchy.
7. **Redis/S24 not in current acceptance path.** Redis/Tailscale reintegration remains pending and must not be inferred from older smoke evidence.
8. **Ollama loopback state unresolved.** Do not claim current Ollama network confinement without fresh host evidence.
9. **Postgres optional.** It must not be described as the sole authoritative state backend today.
10. **No production self-learning/self-modification.** Learning, skill promotion, and self-improvement remain gated future architecture.

## 8. Reconstruction checklist for another engineer

An engineer reconstructing the current Athere runtime should use this order:

1. read `STATUS.md` for the current truth boundary;
2. read `docs/current/DIRECTION.md` and `docs/ARCHITECTURE.md` for governing product/architecture intent;
3. read `docs/current/TITAN.md` for current executable-team and deployment contract;
4. inspect `package.json` for runtime/toolchain requirements;
5. inspect `packages/contracts/src/mission.js` for legal mission states and proof-gated completion;
6. inspect `packages/mission/src/mission-store.js` for durable revision/locking semantics;
7. inspect `packages/orchestrator/src/mission-orchestrator.js` and `packages/command/src/command-planner.js` for command execution flow;
8. inspect `packages/fleet/src/registry.js` for enabled versus preserved-but-disabled agents;
9. inspect `packages/proof/src/proof-store.js` and `packages/recovery/src/recovery-coordinator.js` for evidence and recovery boundaries;
10. inspect `packages/api/src/titan-api.js` and `deploy/systemd-user/athere-titan.service` for the owner API and deployment boundary;
11. run `corepack pnpm test` in a compatible Node >=24 environment;
12. with the configured local service and bearer credential, run `corepack pnpm smoke:functional-team` for live acceptance;
13. compare observed results to `STATUS.md` rather than assuming historical test totals still hold.

## 9. Backlog status after this baseline

With this file present and cross-checked against the implementation tree, backlog **Phase 0 / Item 1** has a durable reconstruction baseline. The next ordered item is **Phase 0 / Item 2 — Build the Athere evaluation harness before major redesign**.

No later backlog item should be treated as implemented merely because this baseline names it.
