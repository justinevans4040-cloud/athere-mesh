# ADK Ergonomics Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live Prepared Context binding, progressive validated-skill disclosure, typed non-authoritative lifecycle hooks, and declarative agent composition without changing Athere mission authority.

**Architecture:** New ergonomics components remain subordinate to the existing Athere control plane. Prepared Context is resolved against current mission state immediately before operational invocation; skills are views over the canonical validated skill library; lifecycle hooks accept frozen events and may only return validated advisory metadata; declarative composition validates fleet/capability/provider/tool/skill/hook/context policy and then feeds the existing runtime rather than creating a second runtime.

**Tech Stack:** Node.js >=24, ESM JavaScript, node:test, pnpm 11.9.0, existing Athere mission/memory/agent/contracts packages.

**Spec:** `docs/superpowers/specs/2026-09-16-adk-ergonomics-layer-design.md`

## Global Constraints

- Preserve exactly one mission-state authority chain.
- Do not edit The Britt 4.0 behavior, identity, or authority.
- Do not reintroduce Odin into Athere Mesh.
- Model output must not become authoritative control fields implicitly.
- MCP must retain `mission_control === false`.
- Advisory chat must remain isolated from operational mission context/tools.
- Prepared Context must be current-state-valid at activation time.
- Skill reuse must remain immutable, versioned, and traceable to validated learning.
- Lifecycle hooks have zero mission-state authority by default.
- All production changes follow red-green-refactor TDD.
- Full `pnpm test` must pass before completion is claimed.

---

## File map

**Create**
- `packages/agent/src/prepared-context-binding.js` — build/write/resolve a mission-bound context for one operational invocation and return provider-safe context metadata.
- `packages/skills/src/progressive-skill-disclosure.js` — compact list/load facade over `createValidatedSkillLibrary()`.
- `packages/agent/src/lifecycle-hooks.js` — phase registry, frozen event dispatch, return-shape validation, required/optional failure semantics.
- `packages/agent/src/agent-composition.js` — declarative composition validator and frozen composition object.
- `tests/contract/prepared-context-invocation.test.js`
- `tests/contract/progressive-skill-disclosure.test.js`
- `tests/contract/lifecycle-hooks.test.js`
- `tests/contract/agent-composition.test.js`
- `tests/contract/agent-runtime-context.test.js`

**Modify**
- `packages/agent/src/agent-runtime.js` — accept optional composition/context/hook dependencies while preserving current behavior when absent.
- `scripts/start-agent-api.js` — construct the canonical composition/runtime path without changing advisory isolation.
- `tests/contract/agent-runtime.test.js` — regression assertions for existing behavior.
- `package.json` only if a narrowly scoped test script is useful; otherwise leave unchanged.
- `docs/current/ADK_ERGONOMICS_LAYER_CURRENT_STATE.md` — final verified current-state record.

---

### Task 1: Prepared Context invocation binding

**Files:**
- Create: `tests/contract/prepared-context-invocation.test.js`
- Create: `packages/agent/src/prepared-context-binding.js`

**Interfaces:**
- Consumes existing exports from `packages/memory/src/prepared-context.js`: `prepareContextPackage`, `writePreparedContext`, `resolvePreparedContext`.
- Produces `createPreparedContextBinder({ service, root, hooks? })`.
- Binder method: `bind({ missionId, reader, query = {}, limit = 8, maxEstimatedTokens = 4096 })`.
- `bind()` returns a frozen object `{ handle, integritySha256, missionId, stateVersion, stateHash, reader, context, stats }`.

- [ ] **Step 1: Write failing binder contract tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPreparedContextBinder } from '../../packages/agent/src/prepared-context-binding.js';

// Reuse the repository's existing mission-service test setup pattern from
// prepared-context.test.js / prepared-context-resolution.test.js.

test('binder creates, persists, resolves, and returns exact current context identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'athere-bind-'));
  try {
    const service = await createMissionServiceFixture();
    const binder = createPreparedContextBinder({ service, root });
    const bound = await binder.bind({ missionId: service.missionId, reader: 'nyx', query: { text: 'current objective' } });
    assert.match(bound.handle, /^ctx_[a-f0-9]{32}$/);
    assert.match(bound.integritySha256, /^[a-f0-9]{64}$/);
    assert.equal(bound.missionId, service.missionId);
    assert.equal(bound.reader, 'nyx');
    assert.ok(Object.isFrozen(bound));
    assert.ok(bound.context);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('binder fails closed if mission revision changes before activation', async () => {
  const service = await createMissionServiceFixture({ mutateBetweenWriteAndResolve: true });
  const binder = createPreparedContextBinder({ service, root: service.root });
  await assert.rejects(
    binder.bind({ missionId: service.missionId, reader: 'nyx' }),
    /prepared-context mission state mismatch|state.*changed|stale/i,
  );
});
```

- [ ] **Step 2: Run the new contract test and verify RED**

Run: `node --test tests/contract/prepared-context-invocation.test.js`

Expected: FAIL because `packages/agent/src/prepared-context-binding.js` does not exist.

- [ ] **Step 3: Implement the minimal binder**

Implementation requirements:

```js
import {
  prepareContextPackage,
  writePreparedContext,
  resolvePreparedContext,
} from '../../memory/src/prepared-context.js';

export function createPreparedContextBinder({ service, root, hooks } = {}) {
  // Validate service/root once.
  // bind(): optional before_context hook -> prepare -> write -> resolve ->
  // optional after_context hook -> return provider-safe frozen projection.
  // Never return service/root/mutation methods.
}
```

The returned projection must copy only immutable data required by a provider and evidence layer. Resolution, not raw read, is the activation step.

- [ ] **Step 4: Run binder and existing Prepared Context contracts**

Run:
`node --test tests/contract/prepared-context-invocation.test.js tests/contract/prepared-context.test.js tests/contract/prepared-context-resolution.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: bind prepared context to agent invocation`

---

### Task 2: Progressive validated-skill disclosure

**Files:**
- Create: `tests/contract/progressive-skill-disclosure.test.js`
- Create: `packages/skills/src/progressive-skill-disclosure.js`

**Interfaces:**
- Consumes a branded validated skill library from `createValidatedSkillLibrary()`.
- Produces `createProgressiveSkillDisclosure({ library })`.
- Methods: `list()` and `load({ skillId, version })`.

- [ ] **Step 1: Write failing disclosure tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProgressiveSkillDisclosure } from '../../packages/skills/src/progressive-skill-disclosure.js';

// Build library using the same validated-learning fixture pattern as skill-library.test.js.

test('list exposes compact descriptors without procedures', async () => {
  const library = await createLibraryWithPublishedSkill();
  const disclosure = createProgressiveSkillDisclosure({ library });
  const [descriptor] = disclosure.list();
  assert.equal(descriptor.skillId, 'repo-review');
  assert.equal(descriptor.version, 1);
  assert.equal('procedure' in descriptor, false);
  assert.ok(Object.isFrozen(descriptor));
});

test('load delegates to canonical library and returns exact validated version', async () => {
  const library = await createLibraryWithPublishedSkill();
  const disclosure = createProgressiveSkillDisclosure({ library });
  const loaded = await disclosure.load({ skillId: 'repo-review', version: 1 });
  assert.equal(loaded.skillId, 'repo-review');
  assert.equal(loaded.version, 1);
  assert.equal(loaded.derivedFromScratch, false);
  assert.equal(typeof loaded.procedure, 'string');
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/contract/progressive-skill-disclosure.test.js`

Expected: FAIL because disclosure module is missing.

- [ ] **Step 3: Implement minimal facade**

Rules:
- Verify the supplied object is a branded validated skill library using existing branding helpers.
- `list()` derives descriptors from `library.list()` every call; no duplicate state.
- `load()` calls `library.reuse()` directly.
- Freeze returned arrays/objects.

- [ ] **Step 4: Verify GREEN with canonical skill tests**

Run: `node --test tests/contract/progressive-skill-disclosure.test.js tests/contract/skill-library.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add progressive validated skill disclosure`

---

### Task 3: Typed non-authoritative lifecycle hooks

**Files:**
- Create: `tests/contract/lifecycle-hooks.test.js`
- Create: `packages/agent/src/lifecycle-hooks.js`

**Interfaces:**
- Produces `LIFECYCLE_PHASES` and `createLifecycleHooks({ hooks = [] })`.
- Hook descriptor shape: `{ phase, handler, required = true, name? }`.
- Dispatch method: `run(phase, event)` returns frozen advisory metadata array.

- [ ] **Step 1: Write failing hook tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createLifecycleHooks } from '../../packages/agent/src/lifecycle-hooks.js';

test('hook input is deeply frozen and phases execute in registration order', async () => {
  const order = [];
  const hooks = createLifecycleHooks({ hooks: [
    { phase: 'before_agent', handler: async (event) => { order.push('one'); assert.ok(Object.isFrozen(event)); return { note: 'one' }; } },
    { phase: 'before_agent', handler: async () => { order.push('two'); return { note: 'two' }; } },
  ] });
  const result = await hooks.run('before_agent', { missionId: 'm1', nested: { value: 1 } });
  assert.deepEqual(order, ['one', 'two']);
  assert.deepEqual(result.map((entry) => entry.note), ['one', 'two']);
});

test('hook result rejects authority-bearing fields', async () => {
  const hooks = createLifecycleHooks({ hooks: [
    { phase: 'before_agent', handler: async () => ({ allowed_actions: ['write'] }) },
  ] });
  await assert.rejects(hooks.run('before_agent', { missionId: 'm1' }), /authority|forbidden|control/i);
});

test('optional telemetry hook failure is non-blocking but required hook failure blocks', async () => {
  const optional = createLifecycleHooks({ hooks: [
    { phase: 'after_agent', required: false, handler: async () => { throw new Error('telemetry down'); } },
  ] });
  assert.deepEqual(await optional.run('after_agent', {}), []);

  const required = createLifecycleHooks({ hooks: [
    { phase: 'after_agent', required: true, handler: async () => { throw new Error('required failed'); } },
  ] });
  await assert.rejects(required.run('after_agent', {}), /required failed/);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/contract/lifecycle-hooks.test.js`

Expected: FAIL because lifecycle hook module is missing.

- [ ] **Step 3: Implement minimal hook registry**

Implementation requirements:
- Exact allowed phases: `before_context`, `after_context`, `before_agent`, `after_agent`, `before_tool`, `after_tool`, `before_verification`, `after_verification`.
- Deep-freeze cloned event input so caller objects are not frozen as a side effect.
- Allow only advisory return keys: `note`, `tags`, `metrics`, `diagnostics`.
- Reject keys such as `allowed_actions`, `state_version`, `agent_id`, `capability_id`, `evidence`, `proof`, `transition`, `authorize`, `mission_state`.
- Required hooks propagate failure.
- Optional hooks swallow their own failure and return no advisory metadata.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/contract/lifecycle-hooks.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add non-authoritative lifecycle hooks`

---

### Task 4: Declarative agent composition

**Files:**
- Create: `tests/contract/agent-composition.test.js`
- Create: `packages/agent/src/agent-composition.js`

**Interfaces:**
- Produces `createAgentComposition({ agentId, capabilityId, modelAdapter, toolAdapters = [], skills, hooks, preparedContext })`.
- Returns frozen `{ agent, capabilityId, modelAdapter, toolAdapters, skills, hooks, preparedContext }`.

- [ ] **Step 1: Write failing composition tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentComposition } from '../../packages/agent/src/agent-composition.js';

test('composition resolves canonical fleet agent and freezes valid configuration', () => {
  const modelAdapter = createSafeModelAdapterFixture();
  const composition = createAgentComposition({
    agentId: 'nyx',
    capabilityId: 'repository-inspector',
    modelAdapter,
  });
  assert.equal(composition.agent.id, 'nyx');
  assert.equal(composition.capabilityId, 'repository-inspector');
  assert.ok(Object.isFrozen(composition));
});

test('composition rejects capability mismatch and mission-owning tool adapters', () => {
  const modelAdapter = createSafeModelAdapterFixture();
  assert.throws(() => createAgentComposition({
    agentId: 'nyx', capabilityId: 'node-test-runner', modelAdapter,
  }), /capability/i);

  assert.throws(() => createAgentComposition({
    agentId: 'nyx', capabilityId: 'repository-inspector', modelAdapter,
    toolAdapters: [{ protocol: 'mcp', capabilities: { mission_control: true } }],
  }), /mission.control|mission_control/i);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/contract/agent-composition.test.js`

Expected: FAIL because composition module is missing.

- [ ] **Step 3: Implement minimal composition validator**

Rules:
- Resolve from canonical `fleetRegistry` only.
- Reject unknown/disabled agents.
- `capabilityId` must equal `agent.executorId`.
- Require model adapter `{ complete, capabilities }` and re-check control-protocol invariant.
- Tool adapters with `capabilities.mission_control === true` are rejected.
- If `skills` exists it must expose `list` and `load`.
- If `hooks` exists it must expose `run`.
- If `preparedContext` exists it must expose `bind`.
- Do not add any mutation or mission store handles.

- [ ] **Step 4: Verify GREEN with adjacent contracts**

Run: `node --test tests/contract/agent-composition.test.js tests/contract/model-adapter.test.js tests/contract/protocol-interop.test.js tests/contract/fleet-contract.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: add declarative agent composition`

---

### Task 5: Integrate composition, context, and hooks into AgentRuntime

**Files:**
- Create: `tests/contract/agent-runtime-context.test.js`
- Modify: `packages/agent/src/agent-runtime.js`
- Modify: `tests/contract/agent-runtime.test.js` only if needed for compatibility assertions.

**Interfaces:**
- Extend `createAgentRuntime({ complete, compositions = [] })` while preserving current `createAgentRuntime({ complete })` behavior.
- Extend operational `respond()` input to accept `contextRequest` only when using a configured composition and a non-advisory mission envelope.

- [ ] **Step 1: Write failing runtime integration tests**

```js
test('operational invocation resolves context before provider call and exposes exact identity', async () => {
  let received;
  const runtime = createAgentRuntime({
    complete: async (request) => { received = request; return { content: 'ok' }; },
    compositions: [compositionWithBinder({ agentId: 'nyx' })],
  });
  const result = await runtime.respond({
    profile: 'owner',
    envelope: operationalNyxEnvelope(),
    contextRequest: { query: { text: 'inspect current mission' } },
  });
  assert.equal(result.content, 'ok');
  assert.equal(received.preparedContext.handle, result.context.handle);
  assert.equal(received.preparedContext.integritySha256, result.context.integritySha256);
});

test('advisory invocation cannot request mission context', async () => {
  const runtime = createAgentRuntime({ complete: async () => ({ content: 'ok' }), compositions: [] });
  await assert.rejects(
    runtime.respond({ profile: 'owner', agentId: 'agent-vale', text: 'hello', contextRequest: { missionId: 'm1' } }),
    /advisory.*context|context.*forbidden/i,
  );
});
```

Also add a stale-context test where the binder rejects and assert `complete` is never called.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/contract/agent-runtime-context.test.js`

Expected: FAIL because runtime does not accept compositions/context requests.

- [ ] **Step 3: Implement minimal runtime integration**

Rules:
- Preserve all current profile/agent/capability/action/advisory checks first.
- Advisory `contextRequest` always fails.
- Operational context uses only the configured composition binder; callers cannot supply a pre-resolved package.
- Run `before_agent` after successful context binding and immediately before provider completion.
- Pass provider only `{ agent, envelope, text, preparedContext?, skills? }` plus non-authoritative hook metadata if needed.
- Run `after_agent` after response validation.
- Return context identity in runtime result for evidence/trace integration.
- If context binding fails, provider is never invoked.

- [ ] **Step 4: Run runtime regression tests**

Run: `node --test tests/contract/agent-runtime-context.test.js tests/contract/agent-runtime.test.js tests/contract/model-adapter.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `feat: integrate context and hooks into agent runtime`

---

### Task 6: Canonical Titan startup composition

**Files:**
- Create or modify a focused startup test following existing service test conventions.
- Modify: `scripts/start-agent-api.js`

**Interfaces:**
- Startup constructs `createModelAdapter()` / `createCompletionFromAdapter()` rather than bypassing the adapter contract.
- Startup may construct a composition for operational agents only where dependencies exist; advisory chat remains compatible.

- [ ] **Step 1: Write failing startup wiring test**

Test the service factory with dependency injection so no real Ollama/Redis/Postgres network is required. Assert:
- existing advisory path can still be constructed;
- canonical model adapter control-field stripping is in path;
- composition wiring does not expose Prepared Context to public advisory chat;
- service close still closes mesh dependencies.

- [ ] **Step 2: Run and verify RED**

Run the focused startup/service contract test.

Expected: FAIL on missing canonical composition/model-adapter wiring assertion.

- [ ] **Step 3: Implement minimal startup wiring**

Use existing `createModelAdapter()` and `createCompletionFromAdapter()` around the Ollama provider. Keep existing `createAgentRuntime({ complete })` compatibility if no operational composition binder can be constructed safely at startup. Do not invent a mission service or second context store.

- [ ] **Step 4: Verify service/API contracts**

Run: `node --test tests/contract/service-contract.test.js tests/contract/agent-runtime*.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit message: `refactor: use canonical agent composition wiring`

---

### Task 7: Live operational evidence binding

**Files:**
- Modify the narrowest existing operational invocation/evidence path identified in `mission-orchestrator.js` and/or its role executor boundary.
- Add or modify a focused contract test near `mission-execution-trace.test.js`.

**Interfaces:**
- Context identity attached to operational evidence must be `{ handle, integritySha256, stateVersion, stateHash, reader }`.
- Evidence attachment must occur through existing mission transition/evidence APIs, not direct store mutation.

- [ ] **Step 1: Trace the actual operational model invocation path**

Read `mission-orchestrator.js`, `role-capability-executor.js`, and any model-backed executor used by an enabled operational agent. Identify the single narrow call boundary where the provider is invoked.

- [ ] **Step 2: Write failing evidence test at that boundary**

The test must prove the same exact context handle/hash reaches both provider request and mission evidence/trace. A separate test mutates mission state after context creation and proves no provider call/evidence success occurs.

- [ ] **Step 3: Run and verify RED**

Run the focused operational evidence test.

Expected: FAIL because context identity is not yet threaded into that operational path.

- [ ] **Step 4: Implement minimal evidence threading**

Use the existing binder and existing mission transition/evidence service. Do not add a second trace store.

- [ ] **Step 5: Verify operational contracts**

Run the focused test plus:
`node --test tests/contract/mission-execution-trace.test.js tests/contract/qr18-layered-verification.test.js tests/contract/agent-envelope.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message: `feat: bind context identity to operational evidence`

---

### Task 8: Hostile authority-boundary review and repair

**Files:**
- Tests first for every discovered defect.
- Production files only after a reproducing failing test exists.

- [ ] **Step 1: Review these attack surfaces**

Attempt to prove or disprove:
- caller can inject a raw prepared context;
- stale package can reach provider;
- reader can switch after package creation;
- hook can smuggle authority fields under nested objects;
- optional hook can mutate shared input by reference;
- skill descriptor can expose procedure accidentally;
- skill load can bypass version/provenance;
- composition can accept a fake fleet agent or mission-owning MCP adapter;
- model provider can leak control fields;
- advisory chat can acquire operational context/tools;
- context evidence can name a different package than provider received.

- [ ] **Step 2: For each confirmed defect, add a failing regression test**

No repair before RED.

- [ ] **Step 3: Implement the smallest repair and run the focused tests**

Expected: all new hostile tests PASS.

- [ ] **Step 4: Re-run hostile review once more**

No known critical/high authority bypass remains.

- [ ] **Step 5: Commit**

Commit message: `test: harden agent ergonomics authority boundaries`

---

### Task 9: Full verification and current-state documentation

**Files:**
- Create: `docs/current/ADK_ERGONOMICS_LAYER_CURRENT_STATE.md`

- [ ] **Step 1: Run focused suites**

```bash
node --test \
  tests/contract/prepared-context*.test.js \
  tests/contract/progressive-skill-disclosure.test.js \
  tests/contract/lifecycle-hooks.test.js \
  tests/contract/agent-composition.test.js \
  tests/contract/agent-runtime*.test.js \
  tests/contract/skill-library.test.js \
  tests/contract/model-adapter.test.js \
  tests/contract/protocol-interop.test.js \
  tests/contract/mission-execution-trace.test.js \
  tests/contract/qr18-layered-verification.test.js
```

Expected: PASS.

- [ ] **Step 2: Run full regression**

Run: `pnpm test`

Expected: PASS with zero failing tests.

- [ ] **Step 3: Run hermetic smoke tests that do not require unavailable external services**

Run relevant local smoke commands from `package.json` only when their configured dependencies are available. Do not claim network-backed smoke coverage if Redis/Postgres/Ollama are unavailable.

- [ ] **Step 4: Write current-state evidence document**

Document:
- exact branch and final commit;
- files added/modified;
- exact focused/full test commands and pass counts;
- exact Prepared Context live flow proven;
- exact skill disclosure contract;
- exact lifecycle hook authority boundary;
- exact composition contract;
- hostile-review findings and repairs;
- explicit unverified external smoke tests, if any;
- statement that The Britt 4.0 was not edited and Odin was not added.

- [ ] **Step 5: Commit**

Commit message: `docs: record verified ADK ergonomics layer state`

---

### Task 10: Final branch verification

- [ ] **Step 1: Compare branch against `master`**

Verify every changed file belongs to the approved scope and no Britt/Odin file changed.

- [ ] **Step 2: Re-run `pnpm test` from the final branch head**

Expected: PASS.

- [ ] **Step 3: Review final diff for placeholders and authority regressions**

Search for `TODO`, `TBD`, stub returns, disabled tests, `.skip`, and accidental test-only bypasses in changed files.

- [ ] **Step 4: Hand off to branch-finishing workflow**

Use `superpowers:finishing-a-development-branch` only after all verification evidence is fresh and green.
