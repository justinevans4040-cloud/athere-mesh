/**
 * Item 20 — agent cryptographic identity and capability boundary.
 * Acceptance: answer exactly which agent had authority for a consequential action.
 */

import { createHash } from 'node:crypto';
import { roleForAgent } from './execution-roles.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

const DEFAULT_BOUNDARIES = Object.freeze({
  'miss-vale-prime': Object.freeze({
    capabilityId: 'mission-supervisor',
    permittedTools: ['mission_supervise'],
    permittedStateAccess: Object.freeze(['mission.read', 'plan.read', 'evidence.read']),
    permittedMutationScope: Object.freeze(['plan.advise', 'supervision.note']),
    executionBudget: Object.freeze({ max_state_mutations: 2, max_tool_calls: 4 }),
  }),
  nyx: Object.freeze({
    capabilityId: 'repository-inspector',
    permittedTools: Object.freeze(['repository_inspect']),
    permittedStateAccess: Object.freeze(['mission.read', 'evidence.read']),
    permittedMutationScope: Object.freeze(['evidence.append', 'observations.append']),
    executionBudget: Object.freeze({ max_state_mutations: 1, max_tool_calls: 2 }),
  }),
  rune: Object.freeze({
    capabilityId: 'node-test-runner',
    permittedTools: Object.freeze(['node_test_run']),
    permittedStateAccess: Object.freeze(['mission.read', 'evidence.read']),
    permittedMutationScope: Object.freeze(['evidence.append', 'results.append']),
    executionBudget: Object.freeze({ max_state_mutations: 1, max_tool_calls: 2 }),
  }),
  qra_emerge_audit: Object.freeze({
    capabilityId: 'proof-verifier',
    permittedTools: Object.freeze(['proof_verify']),
    permittedStateAccess: Object.freeze(['mission.read', 'evidence.read', 'artifacts.read']),
    permittedMutationScope: Object.freeze(['completedWork.advance', 'artifacts.certify']),
    executionBudget: Object.freeze({ max_state_mutations: 1, max_tool_calls: 2 }),
  }),
  qra_recovery_driver: Object.freeze({
    capabilityId: 'recovery-coordinator',
    permittedTools: Object.freeze(['recovery_coordinate']),
    permittedStateAccess: Object.freeze(['mission.read', 'checkpoints.read', 'branches.read']),
    permittedMutationScope: Object.freeze([
      'status.block',
      'checkpoint.create',
      'branch.create',
      'branch.quarantine',
      'checkpoint.rollback',
      'checkpoint.retry',
    ]),
    executionBudget: Object.freeze({ max_state_mutations: 2, max_tool_calls: 4 }),
  }),
});

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requiredId(value, label) {
  const id = requiredText(value, label);
  if (!SAFE_ID.test(id)) throw new Error(`invalid ${label}`);
  return id;
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function stringList(value, label, { max = 32 } = {}) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  if (value.length > max) throw new Error(`${label} exceeds cap ${max}`);
  return Object.freeze(value.map((entry, index) => requiredText(entry, `${label}[${index}]`)));
}

function budgetObject(value, label) {
  const budget = plainObject(value ?? {}, label);
  const max_state_mutations = Number.isSafeInteger(budget.max_state_mutations) && budget.max_state_mutations >= 0
    ? budget.max_state_mutations
    : 0;
  const max_tool_calls = Number.isSafeInteger(budget.max_tool_calls) && budget.max_tool_calls >= 0
    ? budget.max_tool_calls
    : 0;
  return Object.freeze({ max_state_mutations, max_tool_calls });
}

export function fingerprintAgentIdentity({
  agentId,
  role,
  capabilityId,
  publicMaterial = '',
} = {}) {
  const id = requiredId(agentId, 'agentId');
  const roleId = requiredText(role, 'role');
  const capability = requiredText(capabilityId, 'capabilityId');
  const material = typeof publicMaterial === 'string' ? publicMaterial : '';
  const canonical = JSON.stringify({
    v: 1,
    agentId: id,
    role: roleId,
    capabilityId: capability,
    publicMaterial: material,
  });
  const digest = createHash('sha256').update(canonical).digest('hex');
  return `sha256:${digest}`;
}

export function createCapabilityBoundary({
  agentId,
  role,
  capabilityId,
  permittedTools = [],
  permittedStateAccess = [],
  permittedMutationScope = [],
  executionBudget = {},
  publicMaterial,
  revoked = false,
  revokedAt = null,
  revokeReason = null,
} = {}) {
  const id = requiredId(agentId, 'agentId');
  const roleId = role ?? roleForAgent(id);
  const defaults = DEFAULT_BOUNDARIES[id];
  const capability = requiredText(capabilityId ?? defaults?.capabilityId, 'capabilityId');
  const material = publicMaterial ?? `athere-agent-v1:${id}:${capability}`;
  const identityFingerprint = fingerprintAgentIdentity({
    agentId: id,
    role: roleId,
    capabilityId: capability,
    publicMaterial: material,
  });
  return Object.freeze({
    agentId: id,
    role: roleId,
    capabilityId: capability,
    identityFingerprint,
    publicMaterial: material,
    permittedTools: stringList(permittedTools.length ? permittedTools : (defaults?.permittedTools ?? []), 'permittedTools'),
    permittedStateAccess: stringList(
      permittedStateAccess.length ? permittedStateAccess : (defaults?.permittedStateAccess ?? []),
      'permittedStateAccess',
    ),
    permittedMutationScope: stringList(
      permittedMutationScope.length ? permittedMutationScope : (defaults?.permittedMutationScope ?? []),
      'permittedMutationScope',
    ),
    executionBudget: budgetObject(executionBudget?.max_state_mutations !== undefined || executionBudget?.max_tool_calls !== undefined
      ? executionBudget
      : (defaults?.executionBudget ?? {}), 'executionBudget'),
    revoked: revoked === true,
    revokedAt: revokedAt ?? null,
    revokeReason: revokeReason ?? null,
  });
}

export function revokeAgentIdentity(boundary, { revokedAt, reason } = {}) {
  const current = plainObject(boundary, 'identity');
  if (current.revoked === true) return current;
  return Object.freeze({
    ...current,
    revoked: true,
    revokedAt: requiredText(revokedAt, 'revokedAt'),
    revokeReason: requiredText(reason, 'reason'),
  });
}

export function assertCapabilityAllows(boundary, {
  tool,
  stateAccess,
  mutation,
} = {}) {
  const current = plainObject(boundary, 'identity');
  if (current.revoked === true) {
    throw new Error(`agent identity revoked: ${current.agentId}`);
  }
  if (tool !== undefined && !(current.permittedTools ?? []).includes(tool)) {
    throw new Error(`agent ${current.agentId} lacks permitted tool: ${tool}`);
  }
  if (stateAccess !== undefined && !(current.permittedStateAccess ?? []).includes(stateAccess)) {
    throw new Error(`agent ${current.agentId} lacks state access: ${stateAccess}`);
  }
  if (mutation !== undefined && !(current.permittedMutationScope ?? []).includes(mutation)) {
    throw new Error(`agent ${current.agentId} lacks mutation scope: ${mutation}`);
  }
  return true;
}

export function assertIdentityNotRevoked(boundary) {
  const current = plainObject(boundary, 'identity');
  if (current.revoked === true) {
    throw new Error(`agent identity revoked: ${current.agentId}`);
  }
  return current;
}

export function resolveAuthorityFromHistory({
  transitionHistory,
  operationId,
  identity,
} = {}) {
  const opId = requiredId(operationId, 'operationId');
  if (!Array.isArray(transitionHistory)) {
    throw new TypeError('transitionHistory must be an array');
  }
  const entry = transitionHistory.find((item) => item?.operationId === opId);
  if (!entry) throw new Error(`unknown operation: ${opId}`);
  const agentId = requiredId(entry.actor, 'history actor');
  const identityRecord = plainObject(identity, 'identity');
  if (identityRecord.agentId !== agentId) {
    throw new Error(`identity agent mismatch for operation ${opId}`);
  }
  assertIdentityNotRevoked(identityRecord);
  const authorized = entry.authorization?.granted === true
    && entry.authorization?.actor === agentId;
  if (!authorized) {
    throw new Error(`operation ${opId} was not granted authority`);
  }
  return Object.freeze({
    operationId: opId,
    agentId,
    action: entry.action ?? null,
    authorized: true,
    identity: identityRecord,
    identityFingerprint: identityRecord.identityFingerprint,
    authorization: Object.freeze(structuredClone(entry.authorization)),
  });
}

export function defaultBoundaryForAgent(agentId) {
  const id = requiredId(agentId, 'agentId');
  if (!DEFAULT_BOUNDARIES[id]) throw new Error(`unknown operational agent identity: ${id}`);
  return createCapabilityBoundary({ agentId: id });
}

export function listDefaultIdentityAgentIds() {
  return Object.freeze(Object.keys(DEFAULT_BOUNDARIES));
}
