import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

function clock() {
  return '2026-09-04T20:00:00.000Z';
}

function createInput(overrides = {}) {
  return {
    operationId: 'op-ep-create-1',
    id: 'mission-ep-1',
    objective: 'epistemic uncertainty mission',
    goals: [{ id: 'goal-1', objective: 'Know the IP' }],
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
      { actor: 'miss-vale-prime', actions: ['supervise_mission', 'record_epistemic_claim'] },
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'rune', actions: ['execute_node_tests'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof', 'record_epistemic_claim'] },
      {
        actor: 'qra_recovery_driver',
        actions: [
          'block_interrupted_mission',
          'create_checkpoint',
          'create_branch',
          'quarantine_branch',
          'rollback_to_checkpoint',
          'retry_from_checkpoint',
        ],
      },
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

test('Item 17: service records epistemic claims and treats polarities differently', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-ep-17-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput());
  assert.deepEqual(created.mission.epistemicClaims, []);

  const unknown = await service.recordEpistemicClaim({
    operationId: 'op-ep-unknown',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    actor: 'miss-vale-prime',
    claim: {
      id: 'ep-unknown-ip',
      subject: 'SERVER_IP',
      polarity: 'unknown',
      confidence: 0.1,
      reason: 'not observed',
    },
  });
  const assessment = await service.assessUncertainty({ missionId: created.mission.id });
  assert.equal(assessment.claims[0].polarity, 'unknown');
  assert.ok(assessment.triggers.includes('collect_evidence'));
  assert.ok(assessment.triggers.includes('research'));
  assert.equal(assessment.kinds.do_not_know, 1);
  assert.equal(assessment.kinds.verified_false, 0);

  const falsified = await service.recordEpistemicClaim({
    operationId: 'op-ep-false',
    missionId: created.mission.id,
    expectedRevision: unknown.revision,
    actor: 'qra_emerge_audit',
    claim: {
      id: 'ep-false-ip',
      subject: 'LEGACY_HOST',
      polarity: 'verified_false',
      confidence: 0.9,
      reason: 'probe rejected host',
    },
  });
  const afterFalse = await service.assessUncertainty({ missionId: created.mission.id });
  assert.ok(afterFalse.kinds.verified_false >= 1);
  assert.ok(afterFalse.kinds.do_not_know >= 1);
  assert.ok(afterFalse.triggers.includes('second_verifier') || afterFalse.triggers.includes('change_strategy'));
  assert.ok(afterFalse.triggers.includes('collect_evidence'));
  // unknown remains distinct: do_not_know claims are not reclassified as verified_false
  assert.ok(afterFalse.claims.some((claim) => claim.polarity === 'unknown' && claim.kind === 'do_not_know'));
  assert.ok(afterFalse.claims.some((claim) => claim.polarity === 'verified_false' && claim.kind === 'verified_false'));

  const decision = await service.decideNext({ missionId: created.mission.id });
  assert.ok(['research', 'allocate_work', 'escalate_human', 'change_strategy'].includes(decision.nextAction));
  assert.equal(falsified.mission.epistemicClaims.length, 2);

  await assert.rejects(
    () => service.transition({
      operationId: 'op-ep-forge',
      missionId: created.mission.id,
      expectedRevision: falsified.revision,
      signal: { type: 'running', agent: 'miss-vale-prime' },
      update: { epistemicClaims: [], activeAgents: ['miss-vale-prime'] },
      envelope: envelopeFor(falsified, 'op-ep-forge', 'miss-vale-prime'),
    }),
    /epistemicClaims must be changed through epistemic operations|unsupported authoritative state field/,
  );
});

test('Item 17: executor cannot record verified_true epistemic claims', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-ep-17b-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({
    id: 'mission-ep-2',
    operationId: 'op-ep-create-2',
  }));
  await assert.rejects(
    () => service.recordEpistemicClaim({
      operationId: 'op-ep-exec-true',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      actor: 'nyx',
      claim: {
        id: 'ep-bad',
        subject: 'inspect-repository',
        polarity: 'verified_true',
        confidence: 1,
        reason: 'I did it',
      },
    }),
    /lacks required permission|unauthorized epistemic/,
  );
});
