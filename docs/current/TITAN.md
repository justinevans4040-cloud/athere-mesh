# Titan — Functional Team Execution (2026-08-23)

**Status:** implementation verified locally; Ichabod deployment and restart proof are pending. Titan is a reconstruction after the original machine loss, not a recovered copy of the original Titan.

## What this slice provides

Titan accepts ordinary-language commands. Operators do not need to provide JSON.

The first executable command is `test all of Titan` (and equivalent owner test wording). It creates a durable mission, records supervision, repository inspection, real Node test output, and a SHA-256-verified proof. Completion comes from deterministic tool output and stored proof—not from a model response.

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

The owner API binds to loopback. Its functional endpoints are:

| Endpoint | Purpose |
|---|---|
| `GET /health` | Readiness, enabled-team count, and startup-recovery summary |
| `GET /api/team` | Registered team with executor/operational status |
| `POST /api/commands` | Plain UTF-8 text command execution |
| `GET /api/missions/:id` | Durable stored mission result |
| `POST /api/chat` | Advisory model chat only |

Recognized execution requests sent to `/api/chat` return `409` before reaching Ollama. They must use `/api/commands`. A request that is unclear, denied, or lacks an executor returns a truthful non-completion result.

## Local verification

Start the API:

```sh
corepack pnpm start:agent-api
```

In a second shell, run the end-to-end functional smoke:

```sh
corepack pnpm smoke:functional-team
```

The smoke checks `/health`, `/api/team`, sends the normal-language test command, retrieves the stored mission, requires zero failed tests, and requires a matching `proofs/<mission-id>.json` reference with a lowercase 64-character SHA-256. It prints one JSON evidence object only after those checks pass.

## Ichabod user service

The deployable unit is [athere-titan.service](../../deploy/systemd-user/athere-titan.service). It is a **user** service rooted at `/home/the_founder/athere-titan-reconstruction`; it does not require sudo and may read an optional `.env.local` in that directory.

After reviewed code has been copied to that exact path, install and start it as `the_founder`:

```sh
mkdir -p ~/.config/systemd/user
cp deploy/systemd-user/athere-titan.service ~/.config/systemd/user/athere-titan.service
systemctl --user daemon-reload
systemctl --user enable --now athere-titan.service
```

Deployment proof is not complete until the service is active, the functional smoke passes against it, the completed mission survives `systemctl --user restart athere-titan.service`, and the proof file hash is independently checked on Ichabod.

## Explicit non-goals and unresolved boundaries

- Full executor coverage for the rest of the recovered fleet is not implemented.
- Vale Prime fleet deployment remains an artifact-verified planning contract; it is not a live fleet deployment executor.
- Redis/S24 integration remains last and requires the S24 operator session.
- Postgres remains optional; the functional acceptance path uses the atomic filesystem mission/proof store.
- UI work is not part of this functional slice.
- Ubuntu Ollama loopback hardening remains unproven; do not treat the current Ollama listener as loopback-only without fresh service, listener, and API evidence.

## Historical reconstruction material

The prior Slice 0–3 records, evidence, and contest material remain preserved in this repository. They are historical reconstruction evidence and must not be read as proof that the old UI/dev-server commands are the current functional runtime. See [PROGRESS.md](PROGRESS.md), [JUDGE_PACK.md](JUDGE_PACK.md), and [TITAN_OPERATING_MEMORY.md](TITAN_OPERATING_MEMORY.md).

## Programming backup

The verified 2026-08-23 source backup is recorded in [TITAN_PROGRAMMING_BACKUP.md](TITAN_PROGRAMMING_BACKUP.md). Its archive is private in Google Drive; the record documents the SHA-256, included content, exclusions, test result, and status boundary.
