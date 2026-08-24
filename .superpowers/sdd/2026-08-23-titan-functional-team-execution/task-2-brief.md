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

Use `promisify(execFile)` by default. `inspect()` reads and parses `package.json` plus counts current on-disk matching source/test files without a shell. `runTests()` calls Node directly, limits output to 1 MiB, uses a 300-second timeout, and returns `{ command: 'node --test', exitCode, tests, passed, failed, skipped, stdout, stderr }`. Parse the `ℹ tests`, `ℹ pass`, `ℹ fail`, and `ℹ skipped` lines; reject missing summaries.

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
