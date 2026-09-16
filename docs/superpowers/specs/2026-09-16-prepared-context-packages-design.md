# Prepared Context Packages Design

## Goal

Close the remaining persistent-context gap without creating a parallel source of truth. Athere already has authoritative mission state, typed memory, state-aware retrieval, safe current-fact reads, transition-history integrity, and immutable proof publication. This change composes those shipped capabilities into a reusable, content-addressed prepared-context package identified by a deterministic `ctx_*` handle.

## Non-goals

- Do not create a second mission, fact, memory, or truth database.
- Do not weaken typed-memory redaction or expose fact supersession lineage through ordinary model-facing reads.
- Do not add an embeddings/vector dependency or claim embedding-based semantic distillation.
- Do not mutate Titan, The Britt, agent identity, or execution authority.
- Do not treat the prepared package as authoritative after mission state changes. It is a derived artifact bound to a specific verified mission revision.

## Existing authority chain reused

1. `MissionStateService` remains the source of authoritative state.
2. `retrieveMemory()` performs state-aware ranking over a fresh projection of mission state.
3. `select(... currentFacts ...)` exposes only safe current fact values and does not leak predecessor/successor lineage.
4. `verifyHistory()` binds the result to an integrity-checked mission `stateVersion` and `stateHash`.
5. Prepared-context packaging only derives a bounded model-facing view from those authorized outputs.

## Package contract

A prepared-context package has this logical shape:

```text
schemaVersion: athere-prepared-context/v1
handle: ctx_<content digest prefix>
mission:
  id
  stateVersion
  stateHash
reader
query
policy:
  retrieval: state_aware
  maxEntries
  maxEstimatedTokens
  tokenEstimator
context:
  entries[]
stats:
  sourceCandidateCount
  selectedCount
  omittedCount
  sourceEstimatedTokens
  preparedEstimatedTokens
  compactionRatio
integrity:
  algorithm: sha256
  sha256
  canonicalSize
```

The handle and integrity digest are deterministic. No timestamps, random identifiers, host data, or storage paths participate in the hash basis.

## Current-fact hydration boundary

Typed semantic memory intentionally redacts fact values. Packaging must not bypass that rule by reaching into raw mission objects.

For a current semantic candidate, the packager may hydrate `value` only by matching its fact id/key against `MissionStateService.select({ fields: ['currentFacts'] })`. Historical, superseded, corrected, or revoked semantic entries remain redacted. If no safe current fact matches, the entry remains redacted.

Other memory types retain the governed content already returned by state-aware retrieval.

## Deterministic compaction

This iteration implements controlled context compaction, not embedding-based lossy distillation.

1. Start with the retrieval-selected entry, followed by the ranked candidate list with duplicate ids removed.
2. Convert each entry to a compact model-facing projection containing only identity, type, validation state, confidence, score/reasons, provenance, and governed content.
3. Estimate context tokens deterministically as `ceil(UTF8(canonical JSON).bytes / 4)`.
4. Admit entries in priority order while serialized `context` remains within `maxEstimatedTokens`.
5. Record all omitted entries in statistics rather than silently truncating values or JSON bytes.
6. If the selected entry cannot fit, fail closed instead of returning a package that pretends to contain the selected context.

`sourceEstimatedTokens` is measured over the compact projections before budgeting. `preparedEstimatedTokens` is measured over the final `context` object. `compactionRatio` is descriptive evidence from those deterministic estimates, not a claim about a particular model tokenizer.

## Integrity and handle

Canonical JSON recursively sorts object keys while preserving array order. SHA-256 is computed over the package payload excluding `handle` and `integrity`. The public handle is `ctx_` plus a stable digest prefix. Verification reconstructs the hash basis and rejects:

- malformed schema/handle/integrity metadata,
- a digest mismatch,
- a handle/digest mismatch,
- a canonical-size mismatch.

## Durable resolution

Prepared contexts are persisted under the caller-supplied Athere root in a dedicated `contexts/` directory. The store follows the existing proof-store publication pattern:

- validate the handle before constructing a path,
- canonical JSON only,
- write a unique temporary file with `wx`,
- publish immutably with a hard link,
- accept an existing file only when bytes are identical,
- reject idempotency conflicts,
- clean temporary files on both success and failure,
- verify integrity again on read.

The store is a cache/artifact store for derived packages. It is not authoritative state.

## Security and governance properties

- Caller-supplied projected memory is never trusted.
- Safe current fact values come only from the mission-service read boundary.
- Mission history must verify before a package is issued.
- The package is bound to mission id, state version, and state hash.
- Historical semantic values are never rehydrated.
- Content-addressed handles make mutation detectable.
- Path validation prevents handle-based traversal.
- Read verifies package integrity before returning content.

## Verification strategy

Tests must prove:

1. deterministic package and handle generation;
2. state revision/hash changes change the handle;
3. current semantic values are hydrated while historical values stay redacted;
4. selected state-aware context survives budget compaction and lower-ranked context is omitted first;
5. mutation is detected;
6. too-small budgets fail closed;
7. immutable storage is idempotent and resolves by handle;
8. corrupted stored content is rejected;
9. no caller input is mutated.

A dedicated pull-request workflow runs the prepared-context contract tests on Node 24. The full repository test command is required before merge.