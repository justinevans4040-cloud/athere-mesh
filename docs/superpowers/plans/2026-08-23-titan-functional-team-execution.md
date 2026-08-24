# Titan Functional Team Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Titan's registered core team to real deterministic mission execution with durable proof, recovery, a normal-language API, and an Ichabod user service.

**Architecture:** Keep Ollama chat advisory and put all execution behind a new mission orchestrator. The orchestrator composes the existing planner, policy, mission store, Resonance Bus, proof store, and recovery coordinator with injected deterministic executors, then exposes that state through the existing loopback HTTP API.

**Tech Stack:** Node.js 24 ESM, built-in `node:test`, `child_process.execFile`, filesystem durability, HTTP, systemd user services.

**Spec:** `docs/superpowers/specs/2026-08-23-titan-functional-team-execution-design.md`

## Global Constraints

- Operators issue ordinary language; they never need to provide JSON.
- Model prose is advisory and cannot establish execution, proof, or completion.
- Preserve all recovered registry entries; enable only agents with implemented executor contracts.
- Completion requires real zero-failure tool output plus independent proof-file SHA-256 verification.
- Owner API and Ollama remain loopback-only.
- Redis/S24, UI, and Odin are outside this implementation.
- No removals of existing project artifacts.

---

### Task 1: Operational team manifest and advisory boundary

**Files:**
- Modify: `packages/fleet/src/registry.js`
- Modify: `packages/agent/src/agent-runtime.js`
- Modify: `packages/api/src/titan-api.js`
- Modify: `tests/contract/fleet-contract.test.js`
- Modify: `tests/contract/agent-runtime.test.js`
- Modify: `tests/integration/text-chat-api.test.js`

**Interfaces:**
- Produces: `operationalAgents()`, `validateOperationalFleet()`, and registry entries with `executorId`.
- Produces: advisory chat rejection for recognized execution requests.
- Consumes: existing `planCommand({ profile, text })`.

- [ ] **Step 1: Write failing fleet tests**

Add assertions that the six spec-named agents are enabled with exact executor IDs, every enabled agent has an executor ID, and all other recovered entries remain present and disabled.

```js
assert.deepEqual(
  operationalAgents().map(({ id, executorId }) => ({ id, executorId })),
  [
    { id: 'miss-vale-prime', executorId: 'mission-supervisor' },
    { id: 'agent-vale', executorId: 'ollama-chat' },
    { id: 'nyx', executorId: 'repository-inspector' },
    { id: 'rune', executorId: 'node-test-runner' },
    { id: 'qra_emerge_audit', executorId: 'proof-verifier' },
    { id: 'qra_recovery_driver', executorId: 'recovery-coordinator' },
  ],
);
assert.doesNotThrow(() => validateOperationalFleet());
```

- [ ] **Step 2: Run fleet tests and verify RED**

Run: `node --test tests/contract/fleet-contract.test.js`

Expected: FAIL because `operationalAgents` and `validateOperationalFleet` do not exist.

- [ ] **Step 3: Implement the operational manifest**

Keep every existing registry record. Add exact `enabled` and `executorId` fields to the six operational entries, export `operationalAgents()`, and export `validateOperationalFleet()` that throws if an enabled entry lacks a non-empty executor ID.

- [ ] **Step 4: Write failing runtime/API truth-boundary tests**

```js
await assert.rejects(
  () => runtime.respond({ profile: 'owner', agentId: 'loom', text: 'hello' }),
  /agent is not operational/,
);
assert.equal(await postChat('Run all Titan tests'), 409);
assert.equal(completionCalls, 0);
```

- [ ] **Step 5: Run truth-boundary tests and verify RED**

Run: `node --test tests/contract/agent-runtime.test.js tests/integration/text-chat-api.test.js`

Expected: FAIL because disabled agents still respond and execution requests reach chat.

- [ ] **Step 6: Implement the advisory boundary**

Reject disabled agents in `respond`. Inject `planCommand` into the API or import it; before calling the chat runtime, plan the text. If the result is `ready` or `needs_approval`, return HTTP 409 with `{ error: 'execution request must use /api/commands' }`.

- [ ] **Step 7: Run focused and full tests**

Run: `node --test tests/contract/fleet-contract.test.js tests/contract/agent-runtime.test.js tests/integration/text-chat-api.test.js`

Run: `corepack pnpm test`

- [ ] **Step 8: Commit**

```bash
git add packages/fleet/src/registry.js packages/agent/src/agent-runtime.js packages/api/src/titan-api.js tests/contract/fleet-contract.test.js tests/contract/agent-runtime.test.js tests/integration/text-chat-api.test.js
git commit -m "feat: activate evidence-bound Titan core team"
```

### Task 2: Deterministic golden mission orchestrator

**Files:**
- Create: `packages/execution/src/node-test-executor.js`
- Create: `packages/orchestrator/src/mission-orchestrator.js`
- Create: `tests/integration/mission-orchestrator.test.js`
- Create: `tests/integration/node-test-executor.test.js`

**Interfaces:**
- Consumes: `planCommand`, `createMission`, `transitionMission`, `saveMission`, `loadMission`, `writeProof`, `verifyProof`, and `createMemoryResonanceBus`.
- Produces: `createNodeTestExecutor({ execFileImpl })` with `inspect()` and `runTests()`.
- Produces: `createMissionOrchestrator({ root, repositoryRoot, bus, executor, clock, idFactory })` with `execute`, `getMission`, and `recover`.

- [ ] **Step 1: Write failing executor tests**

Inject an `execFileImpl` that records `{ file, args, options }` and returns genuine TAP/spec summary text. Assert the executor invokes `process.execPath` with `['--test']`, `shell: false`, the configured repository root, and a bounded timeout. Assert parsed totals equal the supplied output and a non-zero exit is returned as failure data rather than converted to success.

- [ ] **Step 2: Run executor tests and verify RED**

Run: `node --test tests/integration/node-test-executor.test.js`

Expected: FAIL because the executor module does not exist.

- [ ] **Step 3: Implement the deterministic executor**

Use `promisify(execFile)` by default. `inspect()` reads and parses `package.json` plus counts tracked source/test files without a shell. `runTests()` calls Node directly, limits output to 1 MiB, uses a 300-second timeout, and returns `{ command: 'node --test', exitCode, tests, passed, failed, skipped, stdout, stderr }`. Parse the `ℹ tests`, `ℹ pass`, `ℹ fail`, and `ℹ skipped` lines; reject missing summaries.

- [ ] **Step 4: Write failing orchestrator success and failure tests**

Use a temporary workspace and injected executor. Assert success stores revisioned accepted/running/completed states, includes signals from `miss-vale-prime`, `nyx`, `rune`, and `qra_emerge_audit`, writes a proof, verifies its SHA-256, and returns actual counts. Assert executor failure stores `blocked`, contains no proof completion, and reports the real error.

- [ ] **Step 5: Run orchestrator tests and verify RED**

Run: `node --test tests/integration/mission-orchestrator.test.js`

Expected: FAIL because the orchestrator module does not exist.

- [ ] **Step 6: Implement the orchestrator**

Generate IDs matching `mission-<uuid-without-braces>`. Store each transition with the expected revision. Publish the same state signals to the bus. For the golden command, supervise, inspect, run tests, write proof, call `verifyProof`, and complete only when `exitCode === 0`, `failed === 0`, and verification is true. Catch execution errors, transition to blocked with agent `qra_recovery_driver`, persist, and return the blocked record.

- [ ] **Step 7: Implement explicit non-execution results**

Clarification, denial, and approval responses return planner output without creating a mission. Recognized allowed actions without an executor return `{ status: 'blocked', reason: 'no operational executor for <kind>' }` and never call Ollama.

- [ ] **Step 8: Run focused and full tests**

Run: `node --test tests/integration/node-test-executor.test.js tests/integration/mission-orchestrator.test.js`

Run: `corepack pnpm test`

- [ ] **Step 9: Commit**

```bash
git add packages/execution packages/orchestrator tests/integration/node-test-executor.test.js tests/integration/mission-orchestrator.test.js
git commit -m "feat: execute durable proof-bound Titan missions"
```

### Task 3: Command, team, health, mission, and recovery API

**Files:**
- Modify: `packages/api/src/titan-api.js`
- Modify: `packages/recovery/src/recovery-coordinator.js`
- Modify: `scripts/start-agent-api.js`
- Create: `tests/integration/functional-api.test.js`
- Modify: `tests/integration/recovery-coordinator.test.js`

**Interfaces:**
- Consumes: Task 1 fleet exports and Task 2 orchestrator/executor.
- Produces: the four spec endpoints and startup recovery summary.
- Produces: `recoverInterruptedMissions({ root, clock })`.

- [ ] **Step 1: Write failing recovery tests**

Create accepted, running, blocked, and completed snapshots. Assert recovery transitions accepted/running to blocked with `qra_recovery_driver`, leaves blocked/completed unchanged, persists new revisions, and returns exact recovered IDs.

- [ ] **Step 2: Run recovery tests and verify RED**

Run: `node --test tests/integration/recovery-coordinator.test.js`

Expected: FAIL because `recoverInterruptedMissions` does not exist.

- [ ] **Step 3: Implement safe recovery**

Reuse `inspectRecovery`, `loadMission`, `saveMission`, and `transitionMission`. Never re-run interrupted tools automatically. Convert resumable missions to explicit blocked state with detail `interrupted execution requires operator retry`.

- [ ] **Step 4: Write failing functional API tests**

Start the API with an injected orchestrator and recovery summary. Assert:

```js
assert.equal((await get('/health')).status, 200);
assert.equal((await get('/api/team')).body.enabledAgents, 6);
assert.equal((await post('/api/commands', 'test all of Titan')).body.mission.status, 'completed');
assert.equal((await get(`/api/missions/${missionId}`)).body.mission.id, missionId);
assert.equal((await post('/api/chat?agent=nyx', 'test Titan')).status, 409);
```

Also assert invalid mission IDs return 400, unknown routes return 404, and oversized command bodies return 413.

- [ ] **Step 5: Run API tests and verify RED**

Run: `node --test tests/integration/functional-api.test.js`

Expected: FAIL because command/team/health/mission routes are absent.

- [ ] **Step 6: Implement API routes and startup composition**

Extend `createTitanApi` with required `orchestrator`, `team`, and `recovery` dependencies while preserving chat behavior. Parse routes explicitly and return stored structures without model-generated fields. In `start-agent-api.js`, validate the fleet, create the filesystem root from `TITAN_WORKSPACE_ROOT` or `workspace/titan`, recover interrupted missions, build the executor/orchestrator, and start the API.

- [ ] **Step 7: Run focused and full tests**

Run: `node --test tests/integration/recovery-coordinator.test.js tests/integration/functional-api.test.js tests/integration/text-chat-api.test.js`

Run: `corepack pnpm test`

- [ ] **Step 8: Commit**

```bash
git add packages/api/src/titan-api.js packages/recovery/src/recovery-coordinator.js scripts/start-agent-api.js tests/integration/functional-api.test.js tests/integration/recovery-coordinator.test.js
git commit -m "feat: expose recoverable Titan mission API"
```

### Task 4: Service, live smoke, and truthful documentation

**Files:**
- Create: `deploy/systemd-user/athere-titan.service`
- Create: `scripts/smoke-functional-team.js`
- Modify: `package.json`
- Modify: `docs/current/TITAN.md`
- Modify: `STATUS.md`
- Modify: `ROADMAP.md`
- Create: `tests/contract/service-contract.test.js`
- Create: `tests/integration/functional-smoke.test.js`

**Interfaces:**
- Consumes: Task 3 HTTP API.
- Produces: `pnpm smoke:functional-team` and a user-level service unit rooted at `/home/the_founder/athere-titan-reconstruction`.

- [ ] **Step 1: Write failing service and smoke tests**

Assert the unit has the exact working directory, `ExecStart=/usr/bin/node scripts/start-agent-api.js`, restart policy, optional `.env.local`, and `WantedBy=default.target`. Inject `fetch` into the smoke and assert it calls `/health`, `/api/team`, `/api/commands`, and `/api/missions/:id`, then validates proof path and 64-character lowercase SHA-256.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --test tests/contract/service-contract.test.js tests/integration/functional-smoke.test.js`

Expected: FAIL because the unit and smoke do not exist.

- [ ] **Step 3: Implement service and smoke**

The smoke sends ordinary text `test all of Titan`, requires completed status and zero failed tests, fetches the stored mission, and prints one JSON evidence object only after every assertion passes. Add `smoke:functional-team` to `package.json`.

- [ ] **Step 4: Correct documentation truthfully**

Replace stale UI/dev-script claims with the implemented endpoints, operational-team boundary, exact smoke command, and remaining non-goals. Set `STATUS.md` to the functional execution phase and `ROADMAP.md` to list full agent-executor expansion, Vale deployment, then Redis/S24.

- [ ] **Step 5: Run full local verification**

Run: `corepack pnpm test`

Run: `corepack pnpm audit --prod`

Run: credential-pattern scan over tracked files.

- [ ] **Step 6: Commit**

```bash
git add deploy scripts/smoke-functional-team.js package.json docs/current/TITAN.md STATUS.md ROADMAP.md tests/contract/service-contract.test.js tests/integration/functional-smoke.test.js
git commit -m "feat: package Titan functional team service"
```

- [ ] **Step 7: Deploy and verify on Ichabod**

Archive the feature branch without `.git`, `node_modules`, or environment files. Upload and extract into `/home/the_founder/athere-titan-reconstruction` without removing existing files. Install locked dependencies. Run the full suite on Ichabod. Install the user unit under `~/.config/systemd/user/athere-titan.service`, stop the unmanaged process, enable/start the unit, and run `pnpm smoke:functional-team`.

- [ ] **Step 8: Restart proof**

Record the completed mission ID, restart the user service, verify `/health`, and fetch the same mission ID. Verify the proof file's SHA-256 independently on Ichabod.
