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

/** Instance registry — not forgeable via method-shape injection. */
const BRANDED_IDENTITY_REGISTRIES = new WeakSet();

export function isBrandedAgentIdentityRegistry(value) {
  return value != null && BRANDED_IDENTITY_REGISTRIES.has(value);
}

export function createAgentIdentityRegistry({ seed } = {}) {
  const entries = new Map();
  const agentIds = seed ?? listDefaultIdentityAgentIds();
  for (const agentId of agentIds) {
    entries.set(agentId, createCapabilityBoundary({ agentId }));
  }

  const registry = Object.freeze({
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

  BRANDED_IDENTITY_REGISTRIES.add(registry);
  return registry;
}
