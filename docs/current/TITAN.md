# Titan — Functional Team Execution (2026-08-23)

**Status:** functional execution core is hostile-audited, deployed on Ichabod, and restart-proven. Titan is a reconstruction after the original machine loss, not a recovered copy of the original Titan.

## What this slice provides

Titan accepts ordinary-language commands. Operators do not need to provide JSON.

The first executable command is `test all of Titan` (and equivalent owner test wording). It creates a durable mission, records supervision, current on-disk source/test file counts, real Node test output, and a SHA-256-verified proof. NYX/RUNE evidence and exact validated test totals are persisted in the mission before completion and remain available after restart. Completion comes from deterministic tool output and stored proof—not from a model response.

The operational team is deliberately limited to implemented executors:

| Agent | Executor | Responsibility |
|---|---|---|
| Miss Vale Prime | `mission-supervisor` | Mission supervision |
| Agent Vale | `ollama-chat` | Advisory chat only |
| NYX | `repository-inspector` | Deterministic repository inspection |
| RUNE | `node-test-runner` | Direct `node --test` execution |
| QRA Audit Evidence Strike | `proof-verifier` | Proof completion evidence |
| QRA Recovery Driver | `recovery-coordinator` | Marks interrupted work blocked for operator retry |

Every other recovered registry entry remains preserved and disabled until it has a real executor. Odin is not part of Titan's team or scope.

## API boundary

The owner API binds to loopback and requires a reusable 32–512 byte visible-printable-ASCII bearer credential from `TITAN_API_BEARER_TOKEN`. Loopback is the transport boundary, not caller authentication. The client configures the credential once and reuses it; this does not add per-command human approval.

| Endpoint | Purpose |
|---|---|
| `GET /health` | Public non-sensitive readiness, enabled-team count, and recovery category counts only |
| `GET /api/team` | Public registered team with executor/operational status |
| `POST /api/commands` | Authenticated plain UTF-8 text command execution |
| `GET /api/missions/:id` | Authenticated durable stored mission result |
| `POST /api/chat` | Authenticated advisory model chat only |

Protected requests use `Authorization: Bearer <TITAN_API_BEARER_TOKEN>`. Missing/invalid credentials are rejected before request bodies, executors, stored missions, or Ollama are reached. Cross-site browser fetch metadata/origins are rejected as defense in depth. Recognized execution requests sent to `/api/chat` return `409` before reaching Ollama. They must use `/api/commands`. A request that is unclear, denied, or lacks an executor returns a truthful non-completion result. Only one command execution is admitted at a time; a concurrent request receives `429` with `Retry-After: 1`.

## Local verification

Start the API:

```sh
export TITAN_API_BEARER_TOKEN='<strong random visible-ASCII bearer credential, 32-512 bytes>'
corepack pnpm start:agent-api
```

In a second shell, run the end-to-end functional smoke:

```sh
corepack pnpm smoke:functional-team
```

The smoke reuses `TITAN_API_BEARER_TOKEN`, checks `/health`, `/api/team`, sends the normal-language test command, retrieves the stored mission, requires zero failed tests, and requires a matching `proofs/<mission-id>.json` reference with a lowercase 64-character SHA-256. It prints one JSON evidence object only after those checks pass.

## Ichabod user service

The deployable unit is [athere-titan.service](../../deploy/systemd-user/athere-titan.service). It is a **user** service rooted at `/home/the_founder/athere-titan-reconstruction`; it does not require sudo and may read an optional `.env.local` in that directory. That file must supply a strong `TITAN_API_BEARER_TOKEN`. The unit bounds one admitted suite with `TasksMax=256`, `MemoryMax=2G`, and `CPUQuota=200%`; these limits permit the normal Titan suite while bounding runaway process, memory, and CPU use.

Mission ownership is published only after complete versioned metadata is prepared, using an atomic same-filesystem hard link. Stale takeover is serialized inside the service and checks stable file identity, token, hostname, PID, and—on Linux—boot ID plus process-start ticks before replacement. Node does not provide a portable cross-process conditional pathname replacement, so this guard is intentionally process-local. The operational cross-process boundary is one systemd-managed Titan service process; do not run an unmanaged second API/writer alongside it. A unique incomplete prepared-file artifact can remain after a crash, but it is never the canonical lock and does not block recovery.

The reviewed user service is installed and enabled as `the_founder`. The installation commands are:

```sh
mkdir -p ~/.config/systemd/user
cp deploy/systemd-user/athere-titan.service ~/.config/systemd/user/athere-titan.service
systemctl --user daemon-reload
systemctl --user enable --now athere-titan.service
```

### Verified live evidence

- Runtime source commit: `1c51a65cb1ceed4253779760d069e7a557462788`
- Deployment root: `/home/the_founder/athere-titan-reconstruction`
- Service: enabled and active with login linger; listener `127.0.0.1:5050`
- Ichabod full suite: `109/109` passed; production audit: no known vulnerabilities
- Functional mission: `mission-86939d12-265d-455f-93d6-c159918c968a`
- Post-restart revision/status: `5` / `completed`
- Post-restart result: `109` passed, `0` failed, with durable Titan, Miss Vale, NYX, RUNE, and QRA attribution
- Proof SHA-256, stored and independently recomputed on Ichabod: `3c0c9b5885b95cad55de5a193c46494cb6711735137a23ed510426ec5301aa17`
- Post-restart health: ready, six enabled agents, zero recovered/blocked/corrupt startup records

## Explicit non-goals and unresolved boundaries

- Full executor coverage for the rest of the recovered fleet is not implemented.
- Vale Prime fleet deployment remains an artifact-verified planning contract; it is not a live fleet deployment executor.
- Redis/S24 integration remains last and requires the S24 operator session.
- Postgres remains optional; the functional acceptance path uses the atomic filesystem mission/proof store.
- UI work is not part of this functional slice.
- Ubuntu Ollama loopback hardening remains unproven; do not treat the current Ollama listener as loopback-only without fresh service, listener, and API evidence.
- Cross-process stale-lock takeover depends on the documented single systemd service instance; the in-process keyed guard is not a distributed lock.

## Historical reconstruction material

The prior Slice 0–3 records, evidence, and contest material remain preserved in this repository. They are historical reconstruction evidence and must not be read as proof that the old UI/dev-server commands are the current functional runtime. See [PROGRESS.md](PROGRESS.md), [JUDGE_PACK.md](JUDGE_PACK.md), and [TITAN_OPERATING_MEMORY.md](TITAN_OPERATING_MEMORY.md).

## Programming backup

The verified 2026-08-23 source backup is recorded in [TITAN_PROGRAMMING_BACKUP.md](TITAN_PROGRAMMING_BACKUP.md). Its archive is private in Google Drive; the record documents the SHA-256, included content, exclusions, test result, and status boundary.
