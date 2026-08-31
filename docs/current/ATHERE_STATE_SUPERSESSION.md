# Athere Authoritative Fact Supersession

Athere mission state treats changing authoritative facts as explicit lifecycle operations rather than caller-constructed replacement arrays.

## Fact states

Each authoritative fact has a stable `id`, a semantic `key`, a `value`, and one lifecycle status:

- `current` — the only fact eligible for ordinary authoritative retrieval for its key.
- `superseded` — replaced by a newer current fact.
- `corrected` — replaced because the earlier value was wrong or incomplete.
- `revoked` — explicitly withdrawn; revocation requires a timestamp.
- `historical` — retained for provenance but not eligible as current authority.
- `tentative` — not yet authoritative and excluded from ordinary retrieval.

A key can have at most one `current` fact. Ambiguous states containing multiple current facts for the same key are rejected.

## Atomic mutation boundary

After mission creation, the generic `transition()` path is not allowed to replace `authoritativeFacts`. It fails closed with an instruction to use an atomic fact operation.

The Mission State Service exposes four semantic mutation operations:

- `recordFact()` requires `record_fact` permission and adds a new current or tentative fact. It refuses a second current fact for an existing key.
- `supersedeFact()` requires `supersede_fact` permission and atomically retires one current predecessor while installing exactly one current successor for the same key.
- `correctFact()` requires `correct_fact` permission and atomically marks the predecessor corrected while installing its corrected current successor.
- `revokeFact()` requires `revoke_fact` permission and atomically withdraws a current fact with a revocation timestamp and reason.

Each operation is guarded by the caller's expected mission revision. A stale revision cannot overwrite a newer authoritative state.

Mission creation and legacy import may seed an already internally consistent fact history. Post-creation lifecycle changes must pass through the semantic operations above.

## Lineage invariants

Replacement lineage is bidirectional and validated before persistence.

A successor uses the same semantic key as its predecessor and records `supersedes: <predecessor-id>`. A superseded predecessor records `supersededBy`, while a corrected predecessor records `correctedBy`. Broken references, self-references, cross-key lineage, non-current successors, duplicate IDs, or one-sided lineage are rejected.

Conceptually:

`SERVER_IP_V3 (superseded) -> SERVER_IP_V4 (current)`

The earlier value remains reconstructable, but normal state retrieval exposes only `SERVER_IP_V4`.

## Retrieval boundary

Agents do not receive the raw `authoritativeFacts` collection through ordinary selected-state access.

- `select(..., fields: ['currentFacts'])` exposes current facts only.
- `facts({ missionId })` returns current facts only.
- `facts({ missionId, key })` narrows current authority to one semantic key.
- `includeHistorical: true` is required to retrieve superseded, corrected, revoked, or historical values.
- `includeTentative: true` is required to retrieve tentative values.

This makes historical access an explicit workflow decision instead of an accidental consequence of similarity or stale context.

## Transition provenance

Every atomic fact operation is committed as one versioned authoritative-state revision and one hash-bound transition-ledger entry containing:

- state version and previous version
- actor and exact authorization capability
- semantic action (`record_fact`, `supersede_fact`, `correct_fact`, or `revoke_fact`)
- timestamp
- normalized input
- evidence and verifier
- field-level before/after values
- previous/current state hashes
- transition-chain hashes
- rollback target metadata

A replacement therefore answers who changed the fact, what it replaced, why it changed, which authoritative version contained each value, and what evidence accompanied the change.

## Acceptance invariant

An agent cannot receive a superseded authoritative fact through ordinary current-state selection. An agent also cannot bypass lifecycle semantics by replacing the raw fact collection after mission creation. Historical facts remain available only through an explicit historical query, while every accepted lifecycle operation is preserved in the hash-bound mission transition lineage.
