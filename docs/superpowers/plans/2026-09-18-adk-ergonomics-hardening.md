# ADK Ergonomics Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Close every still-valid finding from the two Codex reviews of PR #2 without migrating the Athere Mesh control plane, editing The Britt 4.0, or introducing Odin.

**Architecture:** Harden the ergonomics layer at its existing boundaries. Canonical factory branding protects model adapters, compositions, and progressive skill disclosure; operational runtime work is explicitly authorized by the existing mission operation contract; Prepared Context is validated and revalidated against authoritative mission state immediately before provider activation; one operation deadline covers hooks, binding, revalidation, and provider completion; observability is attached to the existing mission execution trace.

**Tech Stack:** Node.js 24, ESM JavaScript, node:test, GitHub Actions, existing Athere Mesh mission/agent contracts.

**Spec:** `docs/superpowers/specs/2026-09-16-adk-ergonomics-layer-design.md`

## Global Constraints

- Do not edit The Britt 4.0.
- Do not bring Odin into Athere Mesh.
- Do not migrate or replace the existing control plane.
- Mission state remains authoritative.
- Prepared Context remains read-only/advisory input.
- Model adapters, hooks, skills, and tool adapters cannot claim mission-control authority.
- Use TDD: regression/security test first, observe RED, then minimal implementation, then full regression.
- Preserve offline-first/local Ollama behavior.

---

### Task 1: Canonical construction boundaries

**Files:**
- Modify: `packages/agent/src/model-adapter.js`
- Modify: `packages/agent/src/agent-composition.js`
- Modify: `packages/agent/src/agent-runtime.js`
- Modify: `packages/skills/src/progressive-skill-disclosure.js`
- Test: `tests/contract/agent-composition.test.js`
- Test: `tests/contract/agent-runtime-context.test.js`
- Test: `tests/contract/progressive-skill-disclosure.test.js`

**Interfaces:**
- Produces: `isCanonicalModelAdapter(adapter)`, `isCanonicalAgentComposition(composition)`, and `isBrandedProgressiveSkillDisclosure(disclosure)`.
- Runtime accepts only compositions produced by `createAgentComposition`.
- Composition accepts only canonical model adapters and branded progressive disclosure.
- Tool adapters must declare `capabilities.mission_control === false`.

- [x] **Step 1: Write failing tests**

Add tests equivalent to:

```js
assert.throws(() => createAgentRuntime({ compositions: [forgedComposition] }), /canonical composition/i);
assert.throws(() => createAgentComposition({ ...base, modelAdapter: forgedRemoteAdapter }), /canonical model adapter/i);
assert.throws(() => createAgentComposition({ ...base, toolAdapters: [{}] }), /mission_control.*false/i);
assert.throws(() => createAgentComposition({ ...base, skills: forgedDisclosure }), /progressive.*disclosure|branded/i);
```

- [x] **Step 2: Run focused contracts and verify RED**

Run:

```bash
node --test tests/contract/agent-composition.test.js tests/contract/agent-runtime-context.test.js tests/contract/progressive-skill-disclosure.test.js
```

Expected: new forgery/fail-closed tests fail against the old shape-only validation.

- [x] **Step 3: Implement minimal factory branding**

Use module-private Symbols set only by the canonical factories and exported predicate functions. Keep authority checks in addition to the brand checks.

- [x] **Step 4: Re-run focused tests**

Expected: PASS.

### Task 2: One deadline for the full operational invocation

**Files:**
- Modify: `packages/agent/src/agent-runtime.js`
- Test: `tests/contract/agent-runtime-context.test.js`

**Interfaces:**
- The envelope timeout begins before `before_context`.
- The same deadline bounds `before_context`, context bind, `after_context`, `before_agent`, provider completion, and `after_agent`.

- [x] **Step 1: Write failing timeout tests**

```js
await assert.rejects(
  () => runtime.respond({ profile: 'owner', envelope: shortEnvelope, contextRequest: { query: { text: 'x' } } }),
  /OPERATION_TIMEOUT|timed out/i,
);
assert.equal(providerCalls, 0);
```

Cover a stalled hook and a stalled binder separately.

- [x] **Step 2: Verify RED**
- [x] **Step 3: Add a single operation-deadline helper and wrap each async stage**
- [x] **Step 4: Verify GREEN**

### Task 3: Prepared Context integrity and freshness

**Files:**
- Modify: `packages/agent/src/prepared-context-binding.js`
- Modify: `packages/agent/src/agent-runtime.js`
- Test: `tests/contract/prepared-context-invocation.test.js`
- Test: `tests/contract/agent-runtime-context.test.js`

**Interfaces:**
- `bind()` requires a retrieval query containing non-empty `key`, `text`, or `goalId`.
- Runtime derives `{ text: envelope.objective }` only when its caller omits `contextRequest.query`.
- Bound `stateHash` must be a lowercase SHA-256 hex string.
- Binder provides `revalidate(bound)`; runtime invokes it immediately before model activation.

- [x] **Step 1: Add failing tests for missing query, malformed stateHash, and state change during pre-agent hooks**
- [x] **Step 2: Verify RED**
- [x] **Step 3: Implement query validation, SHA-256 validation, and authoritative revalidation**
- [x] **Step 4: Verify GREEN**

### Task 4: Lifecycle hook data and failure observability

**Files:**
- Modify: `packages/agent/src/lifecycle-hooks.js`
- Test: `tests/contract/lifecycle-hooks.test.js`

**Interfaces:**
- Hook metadata permits only JSON-compatible primitives, arrays, and plain records.
- Map, Set, Date, class instances, functions, symbols, bigint, undefined-in-data, and non-finite numbers fail closed.
- Optional-hook failures return structured advisory diagnostics containing hook name and error identity/message.

- [x] **Step 1: Add failing tests using Map, Date, class instances, and an optional hook that throws**
- [x] **Step 2: Verify RED**
- [x] **Step 3: Implement recursive JSON-data validation and structured optional failure diagnostics**
- [x] **Step 4: Verify GREEN**

### Task 5: Production Prepared Context delivery to Ollama

**Files:**
- Modify: `packages/agent/src/ollama-client.js`
- Test: `tests/contract/titan-startup-model-adapter.test.js` or a focused Ollama contract test included by the full suite

**Interfaces:**
- `createOllamaCompletion` accepts `preparedContext`.
- When provided, the outgoing `/api/chat` request contains a bounded, read-only Prepared Context message with exact identity and resolved context.
- When omitted, advisory chat behavior remains unchanged.

- [x] **Step 1: Add a fetch-fixture test asserting the outgoing request body contains Prepared Context**
- [x] **Step 2: Verify RED**
- [x] **Step 3: Serialize Prepared Context without adding authority claims**
- [x] **Step 4: Verify GREEN**

### Task 6: Canonical authorization for operational NYX reasoning

**Files:**
- Modify: `packages/orchestrator/src/mission-orchestrator.js`
- Modify: `packages/agent/src/agent-runtime.js`
- Test: `tests/contract/operational-prepared-context.test.js`
- Test: `tests/contract/agent-runtime-context.test.js`

**Interfaces:**
- Operational NYX reasoning uses the existing canonical NYX action `observe_repository`, not the synthetic `respond` action.
- The orchestrator calls `authorizeAgentOperation` against current mission permissions/revision before Prepared Context is bound.
- Advisory invocations still use `respond` and remain tool/context isolated.

- [x] **Step 1: Add a failing test proving authorization runs before binder/provider and rejects a permissionless NYX mission**
- [x] **Step 2: Verify RED**
- [x] **Step 3: Build a canonical operation envelope and call existing authorization before runtime activation**
- [x] **Step 4: Verify GREEN**

### Task 7: Operational model observability

**Files:**
- Modify: `packages/orchestrator/src/mission-orchestrator.js`
- Test: `tests/contract/operational-prepared-context.test.js`

**Interfaces:**
- Successful operational NYX reasoning records a model event and latency event through the existing `persistTransition(..., observability)` path.
- Model identity is taken from the canonical operational model adapter.
- No raw model output is added to observability or mission evidence.

- [x] **Step 1: Add failing assertions for executionTrace model + latency events**
- [x] **Step 2: Verify RED**
- [x] **Step 3: Measure invocation latency and attach model identity to existing observability**
- [x] **Step 4: Verify GREEN**

### Task 8: Full verification and review closure

**Files:**
- No production changes unless verification exposes a regression.

- [x] **Step 1: Run focused contracts**

```bash
node --test tests/contract/prepared-context*.test.js tests/contract/progressive-skill-disclosure.test.js tests/contract/lifecycle-hooks.test.js tests/contract/agent-composition.test.js tests/contract/agent-runtime*.test.js tests/contract/titan-startup-model-adapter.test.js tests/contract/operational-prepared-context.test.js
```

- [x] **Step 2: Run full regression**

```bash
pnpm test
```

- [x] **Step 3: Trigger a fresh Codex review on PR #2**
- [x] **Step 4: Inspect all review threads against the new head**
- [x] **Step 5: Do not merge while any valid P1 or P2 hardening finding remains open**


---

## Execution Record

- Implemented on PR #2 branch `feat/adk-ergonomics-layer`.
- Verified focused hardening contracts: **54 tests, 54 pass, 0 fail**.
- Verified full repository regression: **548 tests, 531 pass, 0 fail, 17 skipped**.
- Current verified implementation head before this documentation-only update: `86a79a54496e84a2571c63198f0cf2d460e3b904`.
- Replied to and resolved all **15** original Codex review threads with current-head repair evidence.
- A fresh `@codex review` was triggered after green CI. GitHub's Codex bot could not execute a new review because the account's code-review usage limit was reached. Final closure therefore used direct hostile verification of the current source against all 15 original findings plus green focused/full regression evidence.
- The Britt 4.0 was not edited.
- Odin was not introduced into Athere Mesh.
- The existing Athere Mesh control plane was preserved.
- PR #2 was **not merged** as part of this execution.
