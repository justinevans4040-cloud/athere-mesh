# Athere State Transition History

The Mission State Service stores an append-only transition ledger inside every atomically persisted mission snapshot. Authoritative state and the history that produced it therefore share one revision boundary and cannot be committed independently.

Each mutation records its state and previous versions, actor, action, timestamp, normalized input, output summary, evidence, verifier, authorization decision, field-level before/after values, transition result, and rollback target. SHA-256 hashes bind each entry to both the resulting state and the preceding transition.

`history({ missionId })` returns an isolated copy of the ledger. `verifyHistory({ missionId })` rejects broken version sequences, transition-chain changes, state-hash discontinuities, a ledger revision that differs from the persisted revision, and a ledger head that differs from current authoritative state.

On the first mutation of a mission created before the ledger existed, the service inserts an explicit `import_legacy_snapshot` boundary. It records that prior history and rollback are unavailable, hashes the imported state, and chains every subsequent transition to it instead of inventing an unverifiable past.

Rollback metadata identifies the prior recoverable version and the field-level values required to explain a transition. Actual rollback execution and supersession semantics remain separate backlog work; this service does not silently rewrite history.
