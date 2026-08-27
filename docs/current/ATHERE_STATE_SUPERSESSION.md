# Athere Authoritative Fact Supersession

Athere mission state now treats changing authoritative facts as explicit lifecycle records rather than an undifferentiated memory list.

## Fact states

Each authoritative fact has a stable `id`, a semantic `key`, a `value`, and one lifecycle status:

- `current` — the only fact eligible for ordinary authoritative retrieval for its key.
- `superseded` — replaced by a newer current fact.
- `corrected` — replaced because the earlier value was wrong or incomplete.
- `revoked` — explicitly withdrawn; revocation requires a timestamp.
- `historical` — retained for provenance but not eligible as current authority.
- `tentative` — not yet authoritative and excluded from ordinary retrieval.

A key can have at most one `current` fact. The Mission State Service rejects ambiguous states containing multiple current facts for the same key.

## Lineage

Replacement is bidirectional and validated atomically.

A new current fact may declare `supersedes: <predecessor-id>`. The predecessor must use `superseded` or `corrected` and must point back to the new current fact through `supersededBy` or `correctedBy`. Both records must use the same semantic key.

Broken references, self-references, cross-key lineage, a non-current successor, or one-sided lineage are rejected before persistence.

Example conceptual lineage:

`SERVER_IP_V3 (superseded) -> SERVER_IP_V4 (current)`

The earlier value remains reconstructable in mission history, but normal state retrieval exposes only `SERVER_IP_V4`.

## Retrieval boundary

Agents do not receive the raw `authoritativeFacts` collection through normal selected-state access.

- `select(..., fields: ['currentFacts'])` exposes current facts only.
- `facts({ missionId })` returns current facts only.
- `facts({ missionId, key })` narrows current authority to one semantic key.
- `includeHistorical: true` is required to retrieve superseded, corrected, revoked, or historical values.
- `includeTentative: true` is required to retrieve tentative values.

This makes historical access an explicit operator or workflow decision instead of an accidental consequence of semantic similarity.

## Transition provenance

Fact updates are ordinary authoritative mission-state mutations. They therefore inherit the versioned transition ledger introduced by the Mission State Service:

- state version and previous version
- actor and authorization
- timestamp
- input and output summary
- evidence and verifier
- field-level before/after values
- state hashes
- transition-chain hashes
- rollback metadata

A fact replacement can therefore answer who changed it, what it replaced, why it changed, which exact authoritative state version contained each value, and what evidence accompanied the transition.

## Acceptance invariant

An agent cannot receive a superseded authoritative fact through ordinary current-state selection. Historical facts remain available only through an explicit historical query, while the full mutation is preserved in the hash-bound mission transition lineage.
