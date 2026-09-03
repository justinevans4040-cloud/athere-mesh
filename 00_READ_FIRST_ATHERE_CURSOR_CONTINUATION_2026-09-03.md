# ATHERE MESH — CURSOR CONTINUATION TIE-IN

**Date:** 2026-09-03  
**Status:** Authoritative continuation handoff for current Athere implementation work  
**Repository:** `justinevans4040-cloud/athere-mesh`  
**Branch:** `master`

This file exists at the repository root intentionally so the current continuation state is difficult to miss.

---

# DO NOT REBUILD

This is an existing Athere Mesh implementation.

Do not rebuild it, redesign it, replace subsystems, create a parallel implementation, rename established components, or reinterpret the architecture.

Continue from the existing unresolved point.

Before any code change, read the current Athere continuation state and compare the proposed change against the user's explicit instruction and established work.

Required operating rule:

> Do exactly what I told you to do.  
> Do not rebuild anything.  
> Do not redesign anything.  
> Do not reinterpret anything.  
> Do not add assumptions.  
> Do not create new scope.  
> Do not change established work unless I explicitly told you to change it.  
> Do not skip established runtime goals.  
> Do not move past unresolved required work unless I explicitly authorize it.

---

# REQUIRED READING BEFORE ANY CHANGE

Read these first, in this order:

1. `00_READ_FIRST_ATHERE_CURSOR_CONTINUATION_2026-09-03.md`
2. `runtime/ATHERE_ACTIVE_RUN.md`
3. `research/ATHERE_MESH_MODIFICATION_BACKLOG_2026-08-25.md`
4. `docs/current/ATHERE_ARCHITECTURE_BASELINE_2026-08-26.md`
5. `packages/orchestrator/src/mission-orchestrator.js`
6. `tests/integration/mission-orchestrator.test.js`
7. `packages/mission/src/mission-state-service.js`
8. `packages/mission/src/mission-store.js`
9. Relevant existing Item 8 tests and state-transition tests.

Inspect current `master` and current working-tree status before editing anything.

Repository state and verified runtime evidence outrank old conversation summaries.

---

# CRITICAL CORRECTION TO PRIOR STATE

Any previous statement claiming:

> “Athere Items 1–8 are complete”

is RETRACTED.

Do not use it.

The authoritative live state is:

**Items 2–7 have been acceptance-audited. Item 8 is currently in progress.**

The current backlog item is:

## PHASE 2 / ITEM 8
### Make every state-changing operation idempotent.

Do not advance to Item 9 until Item 8 satisfies its complete acceptance condition.

---

# WHAT HAS ALREADY BEEN IMPLEMENTED FOR ITEM 8

Idempotency has already been introduced for mission transitions.

Current verified behavior:

- state-changing transitions accept persisted operation IDs;
- an exact retry using the same operation ID and same operation data returns the already-existing result;
- an exact retry does NOT create another mission-state revision;
- conflicting reuse of an existing operation ID is rejected;
- the original duplicate-transition defect was reproduced with a RED test before implementation;
- the transition implementation then passed GREEN;
- the latest recorded complete repository verification after this work is 153/153 tests.

Do not rewrite this mechanism merely because another implementation seems cleaner.

Extend the established mechanism.

---

# WHAT IS STILL MISSING

Item 8 remains incomplete.

The next implementation target is to extend the same persisted operation-ID/idempotency contract to:

- mission creation;
- `recordFact`;
- `supersedeFact`;
- `correctFact`;
- `revokeFact`;
- any other state-changing operation discovered during repository inspection that can currently mutate authoritative mission state without the Item 8 contract.

Use the actual current APIs discovered in the repository. Do not invent replacements.

After mutation coverage is complete, audit and harden:

- duplicate detection;
- retry semantics;
- timeout behavior;
- transactional boundaries;
- rollback behavior;
- explicit failure states.

The backlog acceptance condition is the governing requirement:

**Network retries must not be capable of executing the same destructive state-changing action twice.**

---

# REQUIRED IDEMPOTENCY SEMANTICS

For every state-changing operation:

## First execution

A new valid operation ID performs the mutation once and persists enough information to recognize subsequent retries.

## Exact retry

Same operation ID + same effective request:

- return the previously established result;
- do not execute the mutation again;
- do not generate another authoritative state revision merely because the caller retried.

## Conflicting reuse

Same operation ID + materially different request:

- fail closed;
- do not mutate authoritative state;
- do not silently reinterpret the request as a new operation.

## New operation

A genuinely different requested mutation must use a new operation ID.

## Persistence

Idempotency cannot depend only on process-local memory.

The operation record must survive the retry conditions the system is designed to tolerate.

---

# AUTHORITATIVE RUNTIME DATA

Athere mission state is not supposed to live only in model/chat context.

`mission-store.js` persists mission snapshots beneath:

`<runtime-root>/missions/<missionId>.json`

Mission locking data is maintained beside those mission snapshots.

The Titan service derives its runtime root from:

`TITAN_WORKSPACE_ROOT`

If that variable is not set, the default is:

`workspace/titan`

inside the repository.

Therefore the default runtime-data location is:

`<athere-mesh>/workspace/titan/missions/`

Do not blindly assume that default on a live installation.

Before touching live data:

1. inspect the actual environment;
2. determine whether `TITAN_WORKSPACE_ROOT` is set;
3. resolve the effective workspace path;
4. verify existing mission files;
5. preserve all existing mission state and history.

Do not delete, regenerate, migrate, or normalize mission data as part of Item 8.

---

# EVALUATION / CONTROL DATA

The repository already contains permanent evaluation material.

Important current files include:

`evaluations/suites/titan-core-v2.json`

`evaluations/controls/titan-core-v2-42b3a4fc8a85.json`

The accepted v2 control was run against clean commit:

`42b3a4fc8a85`

It contains 12 pinned tasks executed across three trials.

The frozen control artifact was recorded with SHA-256:

`08f56024a5b4be47c3e8edcd1c48aa7dc2388785392233178d1bb0631b254498`

Do not fabricate benchmark data.

Do not replace real controls with synthetic results.

A passing future candidate run does not prove improvement unless it is validly compared against the frozen control under the established evaluation rules.

---

# OTHER EVIDENCE

Existing evidence is stored under:

`evidence/`

This includes historical smoke-test evidence for mission state, persistence, Redis, resonance, Postgres, Arweave, demos, and other previously verified Athere components.

Preserve it.

Do not reinterpret historical evidence as proof of a change that occurred later.

---

# IMPORTANT PRIOR HOSTILE-AUDIT CORRECTIONS

The previous hostile audit found that generic state transition code could replace `authoritativeFacts` directly and thereby bypass the intended fact lifecycle.

That path was closed.

The current implementation now provides permission-scoped semantic fact operations including:

- `recordFact`
- `supersedeFact`
- `correctFact`
- `revokeFact`

Raw post-creation fact-array replacement was rejected.

Additional protections were added for:

- stale revision mutation;
- ambiguous current facts;
- broken cross-key lineage;
- missing revocation timestamp;
- fact supersession/correction lifecycle integrity.

Do not reopen the raw replacement path in order to implement Item 8.

Idempotency must wrap the established lifecycle semantics, not bypass them.

---

# ENGINEERING METHOD

Changes must be test-first.

For each missing Item 8 behavior:

1. reproduce the missing behavior with a failing test;
2. verify RED for the intended reason;
3. implement the narrowest production change;
4. verify GREEN;
5. run the relevant focused test group;
6. run the complete repository test suite using the project's required Node version;
7. run syntax checks;
8. run the existing production dependency/security audit;
9. hostile-audit the result against Item 8's actual acceptance condition;
10. update `runtime/ATHERE_ACTIVE_RUN.md` with what actually happened.

Do not use passing tests alone as proof that an acceptance condition is satisfied.

Evidence before claim.

---

# DO NOT DO THESE THINGS

Do not:

- rebuild Athere Mesh;
- create another mission-state system;
- replace the mission store;
- redesign the architecture;
- move to Item 9 early;
- modify unrelated systems;
- silently repair unrelated code;
- fabricate evidence;
- create synthetic benchmark results and call them measurements;
- delete existing state;
- rewrite history;
- weaken fact lifecycle protections;
- let an operation ID collision silently execute;
- treat process-local duplicate detection as sufficient persistent idempotency;
- use the Android Redis/RAM-pool implementation document as the Item 8 specification.

The Android/Redis RAM-pool work is a separate Athere infrastructure effort.

---

# ITEM 8 COMPLETION GATE

Item 8 may be marked complete only after inspection proves that every authoritative state-changing operation either:

1. implements the established persistent idempotency contract, or
2. has an explicit, documented reason why that operation cannot be retried or does not require such semantics.

Required evidence must demonstrate that:

- exact retries do not duplicate mutations;
- exact retries do not create false extra revisions;
- conflicting operation-ID reuse is rejected;
- mission creation is covered;
- atomic fact lifecycle operations are covered;
- timeout behavior is defined and tested;
- retry behavior is defined and tested;
- transactional boundaries are understood;
- failure states are explicit;
- rollback semantics are audited;
- focused tests pass;
- full repository regression passes;
- hostile audit finds no remaining state-changing path capable of accidental duplicate execution.

Only then update the live checkpoint to state that Item 8 is complete.

Until then:

**ITEM 8 = PARTIAL / IN PROGRESS.**

---

# CURRENT CONTINUATION POINT

Resume here:

**Extend the already-working persisted operation-ID contract from generic mission transitions to mission creation and every atomic authoritative-fact mutation. Then audit timeout, rollback, retry, transaction, and failure semantics against the full Item 8 acceptance condition.**

Do not start over.

Do not move forward around unfinished work.

Finish this exact unresolved point first.
