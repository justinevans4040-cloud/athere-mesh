# Prepared Context Packages Implementation Plan

> **For engineer:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add reusable content-addressed prepared-context packages with deterministic budgeted compaction, integrity verification, and durable handle resolution while preserving mission state as the sole authority.

**Architecture:** `packages/memory/src/prepared-context.js` composes the existing `MissionStateService` public read APIs. State-aware retrieval chooses relevant memory; safe selected state hydrates only current fact values; verified history binds the package to an authoritative state version/hash; deterministic budgeting produces the compact model-facing context. A small immutable file store in the same module persists verified packages under `contexts/<handle>.json` using the proof-store publication pattern.

**Tech Stack:** Node.js >=24, ESM, built-in `node:crypto`, `node:fs/promises`, `node:path`, `node:test`; no new runtime dependencies.

## Task 1: Establish contract tests and CI

**Files:**
- Create: `tests/contract/prepared-context.test.js`
- Create: `.github/workflows/prepared-context-tests.yml`

**Steps:**
1. Write failing tests that import the not-yet-created prepared-context module.
2. Cover deterministic handles, safe semantic hydration, state binding, budgeting, mutation detection, fail-closed budgets, immutable storage, stored corruption, and input immutability.
3. Add a Node 24 pull-request workflow that runs the prepared-context contract test and then the full suite.
4. Open a draft PR and record the expected RED result before implementation.

**Expected RED command:**
`node --test tests/contract/prepared-context.test.js`

Expected failure: module `packages/memory/src/prepared-context.js` does not exist.

## Task 2: Implement pure prepared-context construction

**File:**
- Create: `packages/memory/src/prepared-context.js`

**Steps:**
1. Add canonical JSON normalization and SHA-256 helpers.
2. Add deterministic token estimation based on canonical UTF-8 bytes divided by four.
3. Validate the mission-service facade (`retrieveMemory`, `select`, `verifyHistory`).
4. Retrieve state-aware memory from the authoritative service.
5. Read safe `currentFacts` through `select` and verified state identity through `verifyHistory`.
6. Hydrate only current semantic candidates by safe fact id/key; leave historical semantic values redacted.
7. Compact candidate projections under the configured estimated-token budget, selected entry first.
8. Build the deterministic hash basis and derive `ctx_*` handle plus integrity metadata.
9. Deep-freeze the returned package.

**GREEN command:**
`node --test tests/contract/prepared-context.test.js`

## Task 3: Add verification and immutable handle store

**File:**
- Modify: `packages/memory/src/prepared-context.js`

**Steps:**
1. Add `verifyPreparedContextPackage()` that validates schema, canonical size, SHA-256, and handle binding.
2. Add path containment and handle validation.
3. Add immutable `writePreparedContext()` using temporary `wx` write + hard-link publication.
4. Make duplicate identical writes idempotent and conflicting writes fail closed.
5. Add `readPreparedContext()` that parses then verifies before returning a deeply frozen object.
6. Ensure cleanup errors are not swallowed.

**GREEN command:**
`node --test tests/contract/prepared-context.test.js`

## Task 4: Full regression and hostile review

**Files:**
- Modify only if findings require repair.

**Steps:**
1. Run the prepared-context contract test in CI.
2. Run the full suite with `pnpm test` in CI.
3. Inspect the PR diff for authority bypasses, lineage leaks, nondeterminism, path traversal, silent truncation, mutation, and unverifiable compression claims.
4. Repair findings and rerun both commands.
5. Request code review using the Superpowers review workflow.
6. Do not merge until fresh CI evidence is green and review findings are resolved.

## Task 5: Closeout documentation

**Files:**
- Create or update current-state documentation only after tests prove the implementation.

**Steps:**
1. Record the new prepared-context capability accurately.
2. State explicitly that the implementation is deterministic relevance/budget compaction, not embedding-based semantic distillation.
3. Record measured test evidence without extrapolating unsupported 20x–100x claims.
4. Preserve Odin exclusion and existing shipped-item status.