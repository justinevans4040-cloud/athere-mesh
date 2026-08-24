# Titan Functional Team Execution Design

## Goal

Turn Titan's live identity chat into an evidence-bound mission system that accepts ordinary language, activates a small real team, executes deterministic tools, persists mission state, and reports completion only from verified artifacts.

## Proven starting point

- Ichabod runs the reconstructed Titan API on `127.0.0.1:5050` and Ollama on `127.0.0.1:11434` from Titan's perspective.
- The deployed runtime files match the saved repository.
- The current suite passes 57/57 tests.
- Twenty-five agents, fourteen clusters, and one job are registered, but every registry entry is disabled.
- `/api/chat` routes every registered identity through one generic Ollama completion and can fabricate execution claims.
- Mission, filesystem/Postgres storage, Resonance Bus, proof, recovery, policy, and command-planning components exist but are not connected to the live API.
- The existing system service is inactive, disabled, and points to an older tree; the running reconstruction is an unmanaged process.

## Functional boundary

Titan is functionally operational when a normal-language test mission produces a durable mission record, real tool output, agent-attributed state signals, a verified proof artifact, and a retrievable final result. Model prose never establishes execution state.

The first operational team is:

| Agent | Operational responsibility | Executor |
|---|---|---|
| Miss Vale Prime | Mission supervision | `mission-supervisor` |
| NYX | Repository inspection | `repository-inspector` |
| RUNE | Real test execution | `node-test-runner` |
| QRA Audit Evidence Strike | Proof validation | `proof-verifier` |
| QRA Recovery Driver | Interrupted-mission recovery | `recovery-coordinator` |
| Agent Vale | Public advisory chat only | `ollama-chat` |

All recovered agents remain registered. Only entries with an implemented executor are enabled. Startup validation fails if an enabled operational agent lacks an executor contract.

## Interfaces

### Command execution

`createMissionOrchestrator({ root, repositoryRoot, bus, runTests, clock, idFactory })` returns:

- `execute({ profile, text })`: plan and execute a supported ordinary-language command.
- `getMission({ missionId })`: return a stored mission snapshot.
- `recover()`: convert interrupted accepted/running missions into explicit blocked records assigned to QRA Recovery Driver.

The first executable command is Titan testing. Existing build, SSH-read, and Vale deployment planning remain non-executing until their adapters exist; Titan returns a truthful non-executed status for them.

### HTTP API

- `GET /health` returns service readiness, enabled-team count, and startup-recovery summary.
- `GET /api/team` returns registered identities and whether each has a real executor.
- `POST /api/commands` accepts plain text and returns the resulting stored mission or a clarification/approval/denial response.
- `GET /api/missions/:id` returns the durable mission snapshot.
- `POST /api/chat` remains advisory. If its text is a recognized executable command, it returns HTTP 409 and directs the caller to `/api/commands`; it never sends that request to the model.

### Golden test mission

For an owner request containing `test` and `Titan`:

1. Titan creates and stores an accepted mission.
2. Miss Vale Prime records supervision.
3. NYX inspects the repository using deterministic filesystem/package metadata.
4. RUNE executes `node --test` through `execFile`, never a shell.
5. QRA Audit writes a canonical proof containing the command, exit code, parsed test totals, bounded stdout/stderr, and repository inspection.
6. Titan independently verifies the proof file hash.
7. Titan completes the mission only when exit code is zero, failed tests are zero, and proof verification passes.
8. Any tool or proof failure stores a blocked mission with the real error and no fabricated completion.

The API response includes the mission ID, status, actual test counts, proof path, and SHA-256 from the stored mission.

## Truth boundary

- Model output is advisory text only.
- Execution status, counts, paths, hashes, and completion originate from deterministic code and stored artifacts.
- Disabled agents are rejected by the chat runtime.
- Unknown commands ask one concise clarification.
- Owner/public policy remains enforced before execution.
- No JSON is required from the operator; JSON remains an internal/API representation.

## Persistence and recovery

The first functional slice uses the existing atomic filesystem mission and proof stores under `TITAN_WORKSPACE_ROOT`. Postgres remains available but is not required for this acceptance gate. On startup, accepted or running missions left by an interruption are transitioned to blocked by `qra_recovery_driver`; completed missions remain unchanged and retrievable.

## Service deployment

Provide a user-level systemd unit pointing at `/home/the_founder/athere-titan-reconstruction`. It runs `node scripts/start-agent-api.js`, restarts on failure, uses the existing optional `.env.local`, and avoids sudo. Deployment must install the unit under `~/.config/systemd/user`, enable it, stop the unmanaged reconstruction process, start the unit, and verify `/health` plus a golden mission. Redis/S24 and UI are explicitly outside this slice.

## Acceptance gates

- Existing and new automated tests pass.
- A live ordinary-language golden mission reports the real suite count and zero failures.
- The referenced proof file exists and its SHA-256 verifies.
- The stored mission contains accepted, running, and completed signals attributed to the operational team.
- A fabricated-execution request sent to `/api/chat` is rejected before Ollama is called.
- The user service is active and enabled; restarting it preserves and retrieves the completed mission.
- No agent, mission, or deployment is described as live without executable evidence.
