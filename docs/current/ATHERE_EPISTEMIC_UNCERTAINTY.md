# Athere Epistemic Uncertainty (Item 17)

Explicit uncertainty/confidence state on missions. **"I do not know" ≠ verified false ≠ verified true.**

## Polarities

| Polarity | Kind | Typical triggers |
| --- | --- | --- |
| `unknown` | `do_not_know` | collect_evidence, research, alternate_model |
| `verified_false` | `verified_false` | second_verifier, alternate_model, change_strategy, simulation |
| `verified_true` | `verified_true` | continue |

## API

- `normalizeEpistemicClaim` / `classifyEpistemicPolarity` / `resolveUncertaintyTriggers` / `assessEpistemicState`
- `service.recordEpistemicClaim({ operationId, missionId, expectedRevision, actor, claim })`
- `service.assessUncertainty({ missionId })`
- Executive `decideNext` consults epistemic claims (unknown → research; verified_false → strategy change / escalate)

## Acceptance

Athere treats do-not-know differently from verified false and verified true (distinct kinds + distinct trigger sets).

## Security (local)

- No HTTP route
- `epistemicClaims` not mutable via generic `transition`
- Executors cannot record `verified_true` / `verified_false` even if permission is mis-granted
- Cap 64 claims; evidenceRefs capped at 16; confidence must be 0..1
- Idempotent operation IDs

## Evidence

- `packages/contracts/src/epistemic-state.js`
- `tests/contract/epistemic-state.test.js`
- `tests/integration/epistemic-state-item17.test.js`
