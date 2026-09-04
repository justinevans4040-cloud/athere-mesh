import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { createAgentIdentityRegistry } from '../../packages/identity/src/agent-identity-registry.js';

function clock() {
  return '2026-09-04T21:00:00.000Z';
}

const RECOVERY_ACTIONS = [
  'block_interrupted_mission',
  'create_checkpoint',
  'create_branch',
  'quarantine_branch',
  'rollback_to_checkpoint',
  'retry_from_checkpoint',
];

function createInput(overrides = {}) {
  return {
    operationId: 'op-id20-create-1',
    id: 'mission-id20-1',
    objective: 'agent identity mission',
    goals: [{ id: 'goal-1', objective: 'Reach the end' }],
    subgoals: [
      { id: 'inspect-repository', goalId: 'goal-1', objective: 'Inspect' },
      { id: 'run-node-tests', goalId: 'goal-1', objective: 'Test' },
      { id: 'verify-proof', goalId: 'goal-1', objective: 'Verify' },
    ],
    dependencies: [
      { prerequisite: 'inspect-repository', dependent: 'run-node-tests' },
      { prerequisite: 'run-node-tests', dependent: 'verify-proof' },
    ],
    currentPlan: { id: 'plan-1', version: 1, steps: ['inspect-repository', 'run-node-tests', 'verify-proof'] },
    constraints: ['completion requires independently verified proof'],
    permissions: [
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'rune', actions: ['execute_node_tests'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
      { actor: 'qra_recovery_driver', actions: [...RECOVERY_ACTIONS] },
    ],
    environmentObservations: [
      { source: 'titan', key: 'repository_root', value: '/tmp/repo', observedAt: clock() },
    ],
    ...overrides,
  };
}

function envelopeFor(record, operationId, agentId, action) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    action,
    objective: `${agentId} ${action ?? 'default'}`,
    createdAt: clock(),
  });
}

test('Item 20: authorityFor answers exactly which agent authorized a consequential operation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-id20-'));
  const identities = createAgentIdentityRegistry();
  const service = createMissionStateService({ root, clock, identities });
  const created = await service.create(createInput());

  const opId = 'op-id20-nyx-1';
  const after = await service.transition({
    operationId: opId,
    missionId: created.mission.id,
    expectedRevision: created.revision,
    envelope: envelopeFor(created, opId, 'nyx'),
    signal: { type: 'running', agent: 'nyx' },
    update: {
      evidence: [{ kind: 'observation', detail: 'inspected' }],
      activeAgents: ['nyx'],
    },
  });

  const answer = await service.authorityFor({
    missionId: created.mission.id,
    operationId: opId,
  });
  assert.equal(answer.agentId, 'nyx');
  assert.equal(answer.action, 'observe_repository');
  assert.equal(answer.authorized, true);
  assert.match(answer.identityFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(answer.identity.capabilityId, 'repository-inspector');
  assert.ok(answer.identity.permittedMutationScope.includes('evidence.append'));
  assert.equal(answer.revision, after.revision);

  await assert.rejects(
    () => service.authorityFor({ missionId: created.mission.id, operationId: 'no-such-op' }),
    /unknown operation/,
  );
});

test('Item 20: revoked agent identity cannot perform consequential transitions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-id20b-'));
  const identities = createAgentIdentityRegistry();
  identities.revoke('nyx', { revokedAt: clock(), reason: 'key rotation' });
  const service = createMissionStateService({ root, clock, identities });
  const created = await service.create(createInput({
    operationId: 'op-id20-create-2',
    id: 'mission-id20-2',
  }));

  await assert.rejects(
    () => service.transition({
      operationId: 'op-id20-nyx-revoked',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      envelope: envelopeFor(created, 'op-id20-nyx-revoked', 'nyx'),
      signal: { type: 'running', agent: 'nyx' },
      update: {
        evidence: [{ kind: 'observation', detail: 'should fail' }],
        activeAgents: ['nyx'],
      },
    }),
    /revoked/,
  );

  const audit = await service.agentAuditHistory({
    missionId: created.mission.id,
    agentId: 'nyx',
  });
  assert.deepEqual(audit, []);
});

test('Item 20 safety: revoked identity cannot record facts or epistemic claims', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-id20c-'));
  const identities = createAgentIdentityRegistry();
  identities.revoke('miss-vale-prime', { revokedAt: clock(), reason: 'compromised' });
  const service = createMissionStateService({ root, clock, identities });
  const created = await service.create(createInput({
    operationId: 'op-id20-create-3',
    id: 'mission-id20-3',
    permissions: [
      { actor: 'miss-vale-prime', actions: ['supervise_mission', 'record_fact', 'record_epistemic_claim'] },
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'rune', actions: ['execute_node_tests'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof', 'record_epistemic_claim'] },
      { actor: 'qra_recovery_driver', actions: [...RECOVERY_ACTIONS] },
    ],
  }));

  await assert.rejects(
    () => service.recordFact({
      operationId: 'op-id20-fact-revoked',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      actor: 'miss-vale-prime',
      fact: {
        id: 'fact-1',
        key: 'k',
        value: 'v',
        status: 'current',
        recordedAt: clock(),
      },
    }),
    /revoked/,
  );

  await assert.rejects(
    () => service.recordEpistemicClaim({
      operationId: 'op-id20-ep-revoked',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      actor: 'miss-vale-prime',
      claim: {
        id: 'ep-1',
        subject: 'SERVER_IP',
        polarity: 'unknown',
        confidence: 0.2,
        reason: 'probe incomplete',
      },
    }),
    /revoked/,
  );
});
