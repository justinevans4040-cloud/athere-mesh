# Athere State-Aware Memory Retrieval (Item 15)

Retrieval over Item 14 typed memory that cannot let old similar memories override current verified state.

## API

- `retrieveStateAwareMemory({ mission, projected?, reader, query, limit? })`
- `rankMemoryCandidates({ entries, mission, query, mode })` — `similarity_only` rejected
- `assertRetrievalDoesNotOverrideCurrentState(result, mission)`
- `service.retrieveMemory({ missionId, reader, query, types?, limit? })`

## Query factors (not similarity alone)

current mission, current state, goal, key match, recency, authority/supersession, confidence, secondary text overlap, past-success hints for verified procedural/artifact entries.

## Acceptance

An old but semantically similar memory cannot automatically override current verified state. Current semantic facts win for matching keys; historical candidates are scored down and `mayOverrideCurrent` is always false.

## Security

- Same reader allowlist as Item 14; unauthorized readers fail closed
- Unknown query fields fail closed
- Result limit capped (`1..32`)
- Projection redaction preserved (no fact values / envelopes in retrieval output)
- Caller-supplied `projected` bags cannot bypass redaction: missing/mismatched `reader` fails closed; ranking always re-projects from authoritative mission state
- No HTTP route; does not feed MEA/QR18
- `similarity_only` mode rejected

## Evidence

- `packages/memory/src/state-aware-retrieval.js`
- `tests/contract/state-aware-retrieval.test.js`
- `tests/integration/state-aware-retrieval-item15.test.js`
