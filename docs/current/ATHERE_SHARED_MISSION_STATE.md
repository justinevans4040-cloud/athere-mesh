# Athere Shared Mission State (Blocker 2)

**Status:** implemented as an opt-in Postgres adapter for `createMissionStateService`  
**Doctrine baseline:** shared authoritative mission snapshots across hosts — **not** the full Agent A → Agent B loop

## What this is

The filesystem mission store (`packages/mission/src/mission-store.js`) is still the
offline hermetic default. When an operator configures shared Postgres, the existing
`createPostgresMissionStore` adapter is wrapped to the mission-state-service store
contract (`loadMission` / `saveMission`) and injected.

| Piece | Location |
| --- | --- |
| Postgres snapshot adapter (unchanged API) | `packages/postgres/src/postgres-mission-store.js` |
| State-service store bridge + env resolve | `packages/postgres/src/postgres-mission-state-store.js` |
| Injection point | `createMissionStateService({ store })` |
| Orchestrator opt-in | `createMissionOrchestrator({ store })` — default still filesystem |
| Smoke | `pnpm run smoke:shared-mission-state` |

## Offline-first default

With no `ATHERE_MESH_POSTGRES_URL` / `DATABASE_URL`, `resolveSharedMissionStoreOptions`
returns `null` and nothing touches the network. `createMissionOrchestrator()` without
a `store` argument keeps the filesystem path so the suite stays hermetic.

## Configuration (secrets stay out of git)

```text
ATHERE_MESH_POSTGRES_URL=postgres://athere_mesh@127.0.0.1:5432/athere_mesh
ATHERE_MESH_POSTGRES_PASSWORD_FILE=/path/to/mode-600-pass
```

`DATABASE_URL` is still accepted for older smoke paths. Prefer
`ATHERE_MESH_POSTGRES_PASSWORD_FILE` over embedding the password in the URL when the
process environment is shared.

## Single-writer assumption (deliberately unchanged)

The deployment contract remains **one logical writer** for operational Titan /
orchestrator use. Postgres revision compare-and-swap **fail-closes** conflicting
stale writes (`revision conflict`); it does **not** authorize unmanaged dual writers
or claim multi-master orchestration. Filesystem stale-lock takeover stays
process-local and does not apply to the shared Postgres path — CAS is the
cross-host concurrency boundary.

## What this proves

- Two `createMissionStateService` instances sharing one Postgres-backed store see the
  same authoritative mission revision and fields after a create/transition.
- Hermetic PGlite covers the adapter without a network.
- Live / cross-host evidence (when configured) shows a write on one host and a read
  on another against the same database.

## What this does NOT prove

- Doctrine baseline Agent A → Agent B with zero human intervention (blocker 3 —
  remote executor dispatch — remains open).
- Automatic orchestrator wiring from environment variables (injection is explicit).
- Shared proof / artifact stores (those remain filesystem-rooted).
- Postgres listen/auth topology hardening beyond the operator-configured URL.
- Multi-writer orchestration safety beyond revision CAS rejection.

## Evidence

See `evidence/README.md` and any `evidence/smoke-shared-mission-state-*.json` filed
from a real cross-host run.
