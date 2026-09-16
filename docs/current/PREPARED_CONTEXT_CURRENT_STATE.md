# Prepared Context Current State

**Date:** 2026-09-16  
**Branch:** `feat/prepared-context-packages`  
**Pull request:** #1  
**Status:** Implemented and verified on the feature branch. Not merged into `master` at the time of this record.

## Purpose

Prepared Context closes the reusable-context packaging gap without creating a second source of truth. Mission state remains authoritative. The feature derives a bounded, content-addressed context package from the existing Athere authority and retrieval chain.

## Runtime chain

```text
MissionStateService authority
        |
        v
Typed memory projection
        |
        v
State-aware retrieval
        |
        +--> safe currentFacts hydration for current semantic facts only
        |
        v
Verified mission revision (stateVersion + stateHash)
        |
        v
Deterministic budgeted prepared context
        |
        v
ctx_<sha256-prefix>
        |
        v
Immutable contexts/ store
        |
        v
resolvePreparedContext()
        |
        +--> reader binding check
        +--> requested-handle/path binding check
        +--> live stateVersion/stateHash check
        |
        v
Current-state-valid context activation
```

## Public API

Implemented in `packages/memory/src/prepared-context.js`:

- `estimateContextTokens(value)`
- `prepareContextPackage(options)`
- `verifyPreparedContextPackage(contextPackage)`
- `writePreparedContext({ root, contextPackage })`
- `readPreparedContext({ root, handle })`
- `resolvePreparedContext({ root, handle, service, reader })`

### Activation rule

`readPreparedContext()` is the low-level immutable-store read. It verifies package content integrity and requested-handle binding.

`resolvePreparedContext()` is the activation path for current execution. It additionally requires the requested reader to match the package and requires the package mission `stateVersion` and `stateHash` to match current integrity-bound mission history. A stale package therefore cannot be activated as current context.

## Package identity

Schema:

```text
athere-prepared-context/v1
```

Handle:

```text
ctx_<32 lowercase hex characters>
```

The handle is derived from a SHA-256 digest of canonical package payload bytes. The package also records the complete SHA-256 digest and canonical byte size.

This provides deterministic content addressing and mutation detection. It is **integrity**, not cryptographic authentication of an external author or origin.

## Authority and semantic-value rules

- Caller-supplied projected memory is not trusted as authoritative context.
- State-aware retrieval determines relevance from a fresh mission projection.
- Current semantic fact values are hydrated only through the mission service's safe `currentFacts` read boundary.
- Historical, superseded, corrected, revoked, or unmatched semantic values remain redacted.
- Prepared context never becomes a replacement mission/fact database.
- Every prepared package is bound to a verified mission id, state version, and state hash.

## Compaction behavior

The implemented compaction is deterministic relevance-and-budget compaction.

1. State-aware retrieval supplies the selected and ranked memory candidates.
2. The selected candidate is considered first.
3. Candidates are converted to compact model-facing projections.
4. Estimated tokens are calculated as:

```text
ceil(canonical UTF-8 byte length / 4)
```

5. Candidates are admitted in ranking order while the context remains within `maxEstimatedTokens`.
6. Lower-priority candidates that do not fit are omitted and counted.
7. If the selected context itself cannot fit, packaging fails closed.

Recorded `compactionRatio` is only the ratio between the deterministic source-projection estimate and prepared-context estimate for that package. It is not a promise of a model-specific tokenizer ratio.

## Persistence behavior

Prepared packages are persisted beneath a caller-supplied Athere root:

```text
contexts/<ctx_handle>.json
```

Persistence follows the repository's immutable proof-publication pattern:

- canonical JSON
- temporary `wx` write
- hard-link publication
- identical duplicate writes are idempotent
- conflicting content at the same handle fails closed
- temporary files are cleaned on success or error
- reads reverify package integrity
- requested handles are strictly validated before paths are formed
- stored package handle must equal the requested path handle

## Verification record

TDD and hostile-review sequence completed on PR #1:

1. Contract tests were committed before the initial implementation and observed failing.
2. The initial implementation turned the prepared-context contract green.
3. Hostile PR review found a handle/path binding weakness and the lack of a current-state activation resolver.
4. New resolver tests were committed first and observed failing.
5. The repair added requested-handle binding, reader binding, live mission revision checks, and the `resolvePreparedContext()` activation path.
6. On code commit `3061e052e4c3741e26059da844158563cc9ac305`, GitHub Actions run `35096645297` passed both:
   - `Prepared-context contract`
   - `Full regression suite`
7. Docs Check also passed on that code commit.

## Explicit limits

The current implementation does **not** claim:

- embedding/vector-based semantic distillation
- learned lossy compression
- model-tokenizer-exact token counts
- guaranteed 20x, 50x, or 100x compression
- cryptographic authentication or signatures
- a replacement for mission-state authority

Those would require separate implementation and evidence.

## Scope protection

This work did not modify Titan identity/authority, The Britt, agent identity, or Odin. Odin remains outside this prepared-context implementation.