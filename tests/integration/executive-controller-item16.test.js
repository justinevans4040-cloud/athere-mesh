import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

function clock() {
  return '2026-09-04T19:00:00.000Z';
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
    operationId: 'op-exec-create-1',
    id: 'mission-exec-svc-1',
    objective: 'executive controller mission',
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

test('Item 16: service decideNext allocates work then strategy-changes on block', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-exec-16-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput());

  const first = await service.decideNext({ missionId: created.mission.id });
  assert.equal(first.nextAction, 'allocate_work');
  assert.equal(first.agentId, 'nyx');
  assert.equal(first.mutatesMission, false);

  const running = await service.transition({
    operationId: 'op-exec-run',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: {
      evidence: [{ agent: 'nyx', note: 'inspected' }],
      activeAgents: ['nyx'],
    },
    envelope: envelopeFor(created, 'op-exec-run', 'nyx'),
  });
  const certified = await service.transition({
    operationId: 'op-exec-cert-inspect',
    missionId: created.mission.id,
    expectedRevision: running.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit' },
    update: {
      completedWork: ['inspect-repository'],
      pendingWork: ['run-node-tests', 'verify-proof'],
      activeAgents: [],
    },
    envelope: envelopeFor(running, 'op-exec-cert-inspect', 'qra_emerge_audit'),
  });
  const checkpointed = await service.createCheckpoint({
    operationId: 'op-exec-ckpt',
    missionId: created.mission.id,
    expectedRevision: certified.revision,
    label: 'after-inspect',
    envelope: envelopeFor(certified, 'op-exec-ckpt', 'qra_recovery_driver', 'create_checkpoint'),
  });
  const blocked = await service.transition({
    operationId: 'op-exec-block',
    missionId: created.mission.id,
    expectedRevision: checkpointed.revision,
    signal: { type: 'blocked', agent: 'qra_recovery_driver', detail: 'tests failed' },
    update: {
      failedWork: ['run-node-tests', 'verify-proof'],
      pendingWork: [],
      activeAgents: [],
    },
    envelope: envelopeFor(checkpointed, 'op-exec-block', 'qra_recovery_driver'),
  });

  const decision = await service.decideNext({ missionId: created.mission.id });
  assert.equal(blocked.mission.status, 'blocked');
  assert.equal(decision.nextAction, 'change_strategy');
  assert.equal(decision.agentId, 'qra_recovery_driver');
  assert.equal(decision.canCertifySuccess, false);
  assert.equal(decision.integrityPreserved, true);
  assert.ok(decision.strategyChange?.checkpointId || decision.strategyChange?.action);
});

test('Item 16: decideNext refuses unknown decision actor injection', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-exec-16b-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({
    id: 'mission-exec-svc-2',
    operationId: 'op-exec-create-2',
  }));
  await assert.rejects(
    () => service.decideNext({ missionId: created.mission.id, actor: 'nyx' }),
    /unauthorized executive actor|executive actor/,
  );
});
