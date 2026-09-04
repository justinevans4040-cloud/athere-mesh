import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCapabilityAllows,
  createCapabilityBoundary,
  fingerprintAgentIdentity,
  resolveAuthorityFromHistory,
  revokeAgentIdentity,
} from '../../packages/contracts/src/agent-identity.js';
import {
  createAgentIdentityRegistry,
} from '../../packages/identity/src/agent-identity-registry.js';

test('Item 20 contract: cryptographic identity fingerprint is stable and agent-bound', () => {
  const a = fingerprintAgentIdentity({
    agentId: 'nyx',
    role: 'executor',
    capabilityId: 'repository-inspector',
    publicMaterial: 'nyx-public-v1',
  });
  const b = fingerprintAgentIdentity({
    agentId: 'nyx',
    role: 'executor',
    capabilityId: 'repository-inspector',
    publicMaterial: 'nyx-public-v1',
  });
  const c = fingerprintAgentIdentity({
    agentId: 'rune',
    role: 'executor',
    capabilityId: 'node-test-runner',
    publicMaterial: 'rune-public-v1',
  });
  assert.equal(a, b);
  assert.match(a, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(a, c);
});

test('Item 20 contract: capability boundary includes required fields and supports revoke', () => {
  const boundary = createCapabilityBoundary({
    agentId: 'nyx',
    role: 'executor',
    capabilityId: 'repository-inspector',
    permittedTools: ['repository_inspect'],
    permittedStateAccess: ['mission.read', 'evidence.read'],
    permittedMutationScope: ['evidence.append'],
    executionBudget: { max_state_mutations: 1, max_tool_calls: 2 },
  });
  assert.equal(boundary.agentId, 'nyx');
  assert.equal(boundary.role, 'executor');
  assert.equal(boundary.revoked, false);
  assert.ok(boundary.identityFingerprint.startsWith('sha256:'));
  assert.deepEqual(boundary.permittedTools, ['repository_inspect']);
  assertCapabilityAllows(boundary, { tool: 'repository_inspect', mutation: 'evidence.append' });
  assert.throws(
    () => assertCapabilityAllows(boundary, { tool: 'shell_exec' }),
    /tool/,
  );

  const revoked = revokeAgentIdentity(boundary, {
    revokedAt: '2026-09-04T21:00:00.000Z',
    reason: 'compromised',
  });
  assert.equal(revoked.revoked, true);
  assert.throws(
    () => assertCapabilityAllows(revoked, { tool: 'repository_inspect' }),
    /revoked/,
  );
});

test('Item 20 contract: authority resolves from ledger history by operationId', () => {
  const history = [
    {
      operationId: 'op-nyx-1',
      actor: 'nyx',
      action: 'observe_repository',
      authorization: { actor: 'nyx', actions: ['observe_repository'], granted: true },
    },
    {
      operationId: 'op-audit-1',
      actor: 'qra_emerge_audit',
      action: 'verify_proof',
      authorization: { actor: 'qra_emerge_audit', actions: ['verify_proof'], granted: true },
    },
  ];
  const answer = resolveAuthorityFromHistory({
    transitionHistory: history,
    operationId: 'op-nyx-1',
    identity: createCapabilityBoundary({
      agentId: 'nyx',
      role: 'executor',
      capabilityId: 'repository-inspector',
      permittedTools: ['repository_inspect'],
      permittedStateAccess: ['mission.read'],
      permittedMutationScope: ['evidence.append'],
      executionBudget: { max_state_mutations: 1, max_tool_calls: 1 },
    }),
  });
  assert.equal(answer.agentId, 'nyx');
  assert.equal(answer.action, 'observe_repository');
  assert.equal(answer.authorized, true);
  assert.equal(answer.identity.agentId, 'nyx');
  assert.throws(
    () => resolveAuthorityFromHistory({
      transitionHistory: history,
      operationId: 'missing',
      identity: answer.identity,
    }),
    /unknown operation/,
  );
});

test('Item 20 contract: registry lists operational identities with capability boundaries', () => {
  const registry = createAgentIdentityRegistry();
  const nyx = registry.get('nyx');
  assert.equal(nyx.agentId, 'nyx');
  assert.equal(nyx.revoked, false);
  assert.ok(nyx.permittedTools.includes('repository_inspect'));
  assert.ok(registry.list().length >= 5);
  registry.revoke('nyx', { revokedAt: '2026-09-04T21:00:00.000Z', reason: 'test' });
  assert.equal(registry.get('nyx').revoked, true);
});
