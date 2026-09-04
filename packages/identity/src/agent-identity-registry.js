/**
 * Item 20 — in-process agent identity registry.
 * Cryptographic fingerprints + capability boundaries; revocation tracked here.
 */

import {
  assertIdentityNotRevoked,
  createCapabilityBoundary,
  listDefaultIdentityAgentIds,
  revokeAgentIdentity,
} from '../../contracts/src/agent-identity.js';

export function createAgentIdentityRegistry({ seed } = {}) {
  const entries = new Map();
  const agentIds = seed ?? listDefaultIdentityAgentIds();
  for (const agentId of agentIds) {
    entries.set(agentId, createCapabilityBoundary({ agentId }));
  }

  return Object.freeze({
    has(agentId) {
      return entries.has(agentId);
    },
    get(agentId) {
      const entry = entries.get(agentId);
      if (!entry) throw new Error(`unknown agent identity: ${agentId}`);
      return entry;
    },
    list() {
      return Object.freeze([...entries.values()]);
    },
    revoke(agentId, { revokedAt, reason } = {}) {
      const current = this.get(agentId);
      const next = revokeAgentIdentity(current, { revokedAt, reason });
      entries.set(agentId, next);
      return next;
    },
    assertActive(agentId) {
      return assertIdentityNotRevoked(this.get(agentId));
    },
  });
}
