# Athere Distributed State Layer (Item 24)

**Status:** implemented as an opt-in primary + replica + event-stream wrapper over the existing mission store contract  
**Acceptance:** Distribution increases capacity without weakening state authority or verification guarantees.

## What this is

After Items 2–23 proved the centralized spine (MEA, QR18, idempotency, shared Postgres single-writer CAS), Item 24 adds a **distributed blackboard layer** that:

- Keeps **one authoritative primary writer** (`loadMission` / `saveMission` with revision CAS)
- Syncs **read replicas** after each successful primary save (capacity reads)
- Appends an **event stream** of authoritative saves
- Exposes shard routing **metadata only** (does not create multi-writer shards)

| Piece | Location |
| --- | --- |
| Contracts | `packages/contracts/src/distributed-state.js` |
| Layer | `packages/distributed/src/distributed-mission-store.js` |
| Service opt-in | `createMissionStateService({ distributed: true })` or inject a layer |
| Docs | this file |

## Offline-first default

`distributed` defaults to `null`. Hermetic filesystem / Postgres stores behave as before. No new HTTP surface. No Redis mission-state writes.

## Capacity without weaker authority

- `loadMissionReplica` returns `authoritative: false` and never claims primary role
- Replica loads do not increment primary load counters (topology proves capacity reads)
- Service mutations still load/save only through the primary path inside the layer
- Replica mission payloads are cloned so callers cannot mutate primary memory via a replica handle

## Forbidden (fail closed)

- Multi-master write
- CRDT authority merge
- Replica promote to writer
- Quorum bypass of revision CAS
- Geo dual-primary
- Forging `distributedState` / `replicas` / `stateEventLog` via `transition`
- Unbranded injectable “distributed” wrappers (must be `true` or `createDistributedMissionStore` brand)
- Using replica snapshots for verification (`assertCannotVerifyFromReplica`)
- Unsafe mission ids on replica/event APIs (SAFE_ID)
- Uncapped shard count (`MAX_SHARDS=64`)

## What this does NOT prove

- Multi-master orchestration or automatic failover
- Cross-host physical replica processes (hermetic layer syncs in-process; compose with Postgres primary for cross-host authority)
- Full geo distribution, CRDTs for mission authority, or consensus election
- Mission-hash of process-local skill/improvement libraries (still deferred)

## Evidence

- `tests/contract/distributed-state.test.js`
- `tests/integration/distributed-state-item24.test.js`
- `tests/integration/distributed-state-item24-security.test.js`
