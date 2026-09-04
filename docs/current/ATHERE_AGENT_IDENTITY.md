# Athere Agent Identity (Item 20)

Cryptographic identity fingerprints and capability boundaries for operational agents.

**Acceptance:** Athere can answer exactly which agent had authority to perform any consequential action.

## Each agent identity includes

- identity fingerprint (`sha256:…` over canonical agent material)
- role
- capability id
- permitted tools
- permitted state access
- permitted mutation scope
- execution budget
- revocation flag + auditability via mission ledger

Signed envelopes remain future work; authority answers bind to the hash-chained `transitionHistory` actor + identity registry.

## API

- `packages/contracts/src/agent-identity.js` — fingerprint, boundary, revoke, `resolveAuthorityFromHistory`
- `packages/identity/src/agent-identity-registry.js` — `createAgentIdentityRegistry()`
- `service.authorityFor({ missionId, operationId })`
- `service.agentAuditHistory({ missionId, agentId })`

## Security (local)

- Revoked identities cannot transition, recover, or mutate facts/epistemic claims
- Authority answers come from ledger actors only (no caller-supplied actor override)
- Unknown operationId fails closed
- Unbranded identities registries rejected (WeakSet factory brand)
- Unregistered actors cannot write facts (must be enrolled + active)
- No new HTTP surface
- Default registry covers MEA/recovery operational agents only

## Evidence

- `tests/contract/agent-identity.test.js`
- `tests/integration/agent-identity-item20.test.js`
