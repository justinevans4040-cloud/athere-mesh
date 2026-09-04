import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

function clock() {
  return '2026-09-04T08:00:00.000Z';
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
    operationId: 'op-ckpt-create-1',
    id: 'mission-ckpt-1',
    objective: 'long recoverable mission',
    goals: [{ id: 'goal-1', objective: 'Reach the end' }],
    subgoals: [
      { id: 'step-a', goalId: 'goal-1', objective: 'A' },
      { id: 'step-b', goalId: 'goal-1', objective: 'B' },
      { id: 'step-c', goalId: 'goal-1', objective: 'C' },
    ],
    dependencies: [
      { prerequisite: 'step-a', dependent: 'step-b' },
      { prerequisite: 'step-b', dependent: 'step-c' },
    ],
    currentPlan: { id: 'plan-1', version: 1, steps: ['step-a', 'step-b', 'step-c'] },
    constraints: ['completion requires independently verified proof'],
    permissions: [
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'nyx', actions: ['observe_repository'] },
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

async function seedNearEnd(service, created) {
  const supervised = await service.transition({
    operationId: `${created.mission.id}-run-mgr`,
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'miss-vale-prime' },
    update: { activeAgents: ['miss-vale-prime'] },
    envelope: envelopeFor(created, `${created.mission.id}-run-mgr`, 'miss-vale-prime'),
  });
  const performed = await service.transition({
    operationId: `${created.mission.id}-run-nyx`,
    missionId: created.mission.id,
    expectedRevision: supervised.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: {
      evidence: [{ agent: 'nyx', note: 'steps a/b executed' }],
      activeAgents: ['nyx'],
    },
    envelope: envelopeFor(supervised, `${created.mission.id}-run-nyx`, 'nyx'),
  });
  const afterA = await service.transition({
    operationId: `${created.mission.id}-cert-a`,
    missionId: created.mission.id,
    expectedRevision: performed.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit' },
    update: {
      completedWork: ['step-a'],
      pendingWork: ['step-b', 'step-c'],
      activeAgents: [],
    },
    envelope: envelopeFor(performed, `${created.mission.id}-cert-a`, 'qra_emerge_audit'),
  });
  const afterB = await service.transition({
    operationId: `${created.mission.id}-cert-b`,
    missionId: created.mission.id,
    expectedRevision: afterA.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit' },
    update: {
      completedWork: ['step-a', 'step-b'],
      pendingWork: ['step-c'],
      activeAgents: [],
    },
    envelope: envelopeFor(afterA, `${created.mission.id}-cert-b`, 'qra_emerge_audit'),
  });
  return afterB;
}

test('Item 12: create initializes empty checkpoints/branches and rejects transition mutation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-ckpt-init-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput());
  assert.deepEqual(created.mission.checkpoints, []);
  assert.deepEqual(created.mission.branches, []);
  assert.equal(created.mission.activeBranchId, 'main');

  const running = await service.transition({
    operationId: 'op-ckpt-init-run',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'miss-vale-prime' },
    update: { activeAgents: ['miss-vale-prime'] },
    envelope: envelopeFor(created, 'op-ckpt-init-run', 'miss-vale-prime'),
  });

  await assert.rejects(
    () => service.transition({
      operationId: 'op-ckpt-mutate',
      missionId: created.mission.id,
      expectedRevision: running.revision,
      signal: { type: 'running', agent: 'miss-vale-prime' },
      update: { checkpoints: [{ id: 'forged' }] },
      envelope: envelopeFor(running, 'op-ckpt-mutate', 'miss-vale-prime'),
    }),
    /unsupported authoritative state field|checkpoints/i,
  );
});

test('Item 12: verified checkpoint + alternate branch + quarantine + rollback resumes without full restart', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-ckpt-e2e-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({ id: 'mission-ckpt-e2e', operationId: 'op-ckpt-e2e-create' }));
  const nearEnd = await seedNearEnd(service, created);

  const checkpointed = await service.createCheckpoint({
    operationId: 'op-ckpt-take-1',
    missionId: created.mission.id,
    expectedRevision: nearEnd.revision,
    label: 'known-good-before-final',
    envelope: envelopeFor(nearEnd, 'op-ckpt-take-1', 'qra_recovery_driver', 'create_checkpoint'),
  });
  assert.equal(checkpointed.mission.checkpoints.length, 1);
  const checkpoint = checkpointed.mission.checkpoints[0];
  assert.equal(checkpoint.verified, true);
  assert.ok(checkpoint.stateHash);
  assert.deepEqual(checkpoint.snapshot.completedWork, ['step-a', 'step-b']);
  assert.deepEqual(checkpoint.snapshot.pendingWork, ['step-c']);

  const branched = await service.createBranch({
    operationId: 'op-ckpt-branch-1',
    missionId: created.mission.id,
    expectedRevision: checkpointed.revision,
    checkpointId: checkpoint.id,
    strategy: 'alternate-final-approach',
    envelope: envelopeFor(checkpointed, 'op-ckpt-branch-1', 'qra_recovery_driver', 'create_branch'),
  });
  assert.equal(branched.mission.branches.length, 1);
  assert.equal(branched.mission.branches[0].status, 'active');
  assert.equal(branched.mission.activeBranchId, branched.mission.branches[0].id);

  // ~90% failure on the alternate branch: block with step-c failed.
  const failed = await service.transition({
    operationId: 'op-ckpt-fail-1',
    missionId: created.mission.id,
    expectedRevision: branched.revision,
    signal: { type: 'blocked', agent: 'qra_recovery_driver', detail: 'final step failed on alternate branch' },
    update: {
      pendingWork: [],
      failedWork: ['step-c'],
      activeAgents: [],
    },
    envelope: envelopeFor(branched, 'op-ckpt-fail-1', 'qra_recovery_driver', 'block_interrupted_mission'),
  });
  assert.equal(failed.mission.status, 'blocked');
  assert.deepEqual(failed.mission.failedWork, ['step-c']);

  const quarantined = await service.quarantineBranch({
    operationId: 'op-ckpt-quar-1',
    missionId: created.mission.id,
    expectedRevision: failed.revision,
    branchId: branched.mission.branches[0].id,
    reason: 'alternate strategy failed at final step',
    envelope: envelopeFor(failed, 'op-ckpt-quar-1', 'qra_recovery_driver', 'quarantine_branch'),
  });
  assert.equal(quarantined.mission.branches[0].status, 'quarantined');
  assert.equal(quarantined.mission.activeBranchId, 'main');

  const rolled = await service.rollbackToCheckpoint({
    operationId: 'op-ckpt-roll-1',
    missionId: created.mission.id,
    expectedRevision: quarantined.revision,
    checkpointId: checkpoint.id,
    envelope: envelopeFor(quarantined, 'op-ckpt-roll-1', 'qra_recovery_driver', 'rollback_to_checkpoint'),
  });

  // Acceptance: no full mission restart — known-good work preserved, status resumed.
  assert.equal(rolled.mission.status, 'running');
  assert.deepEqual(rolled.mission.completedWork, ['step-a', 'step-b']);
  assert.deepEqual(rolled.mission.pendingWork, ['step-c']);
  assert.deepEqual(rolled.mission.failedWork, []);
  assert.equal(rolled.mission.objective, created.mission.objective);
  assert.ok(rolled.mission.environmentObservations.some((obs) => obs.key === 'environment_resync'));
  assert.equal(rolled.mission.checkpoints.length, 1);
  assert.equal(rolled.mission.branches[0].status, 'quarantined');
});

test('Item 12: retry_from_checkpoint restores last known-good and is idempotent on same operationId', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-ckpt-retry-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({ id: 'mission-ckpt-retry', operationId: 'op-ckpt-retry-create' }));
  const nearEnd = await seedNearEnd(service, created);
  const checkpointed = await service.createCheckpoint({
    operationId: 'op-ckpt-retry-take',
    missionId: created.mission.id,
    expectedRevision: nearEnd.revision,
    label: 'pre-fail',
    envelope: envelopeFor(nearEnd, 'op-ckpt-retry-take', 'qra_recovery_driver', 'create_checkpoint'),
  });
  const failed = await service.transition({
    operationId: 'op-ckpt-retry-fail',
    missionId: created.mission.id,
    expectedRevision: checkpointed.revision,
    signal: { type: 'blocked', agent: 'qra_recovery_driver', detail: 'interrupted' },
    update: {
      pendingWork: [],
      failedWork: ['step-c'],
      activeAgents: [],
    },
    envelope: envelopeFor(checkpointed, 'op-ckpt-retry-fail', 'qra_recovery_driver', 'block_interrupted_mission'),
  });
  const retryEnvelope = envelopeFor(failed, 'op-ckpt-retry-1', 'qra_recovery_driver', 'retry_from_checkpoint');
  const first = await service.retryFromCheckpoint({
    operationId: 'op-ckpt-retry-1',
    missionId: created.mission.id,
    expectedRevision: failed.revision,
    checkpointId: checkpointed.mission.checkpoints[0].id,
    envelope: retryEnvelope,
  });
  assert.equal(first.mission.status, 'running');
  assert.deepEqual(first.mission.pendingWork, ['step-c']);

  const dup = await service.retryFromCheckpoint({
    operationId: 'op-ckpt-retry-1',
    missionId: created.mission.id,
    expectedRevision: failed.revision,
    checkpointId: checkpointed.mission.checkpoints[0].id,
    envelope: retryEnvelope,
  });
  assert.equal(dup.duplicate, true);
  assert.equal(dup.revision, first.revision);
});

test('Item 12: tampered checkpoint hash fails closed; non-recovery actor cannot checkpoint', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-ckpt-hostile-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({ id: 'mission-ckpt-hostile', operationId: 'op-ckpt-hostile-create' }));
  const nearEnd = await seedNearEnd(service, created);
  const checkpointed = await service.createCheckpoint({
    operationId: 'op-ckpt-hostile-take',
    missionId: created.mission.id,
    expectedRevision: nearEnd.revision,
    label: 'good',
    envelope: envelopeFor(nearEnd, 'op-ckpt-hostile-take', 'qra_recovery_driver', 'create_checkpoint'),
  });

  await assert.rejects(
    () => service.createCheckpoint({
      operationId: 'op-ckpt-hostile-nyx',
      missionId: created.mission.id,
      expectedRevision: checkpointed.revision,
      label: 'stolen',
      envelope: envelopeFor(checkpointed, 'op-ckpt-hostile-nyx', 'nyx'),
    }),
    /recovery|permission|not bound|exclusively permit|unknown/i,
  );

  const blocked = await service.transition({
    operationId: 'op-ckpt-hostile-block',
    missionId: created.mission.id,
    expectedRevision: checkpointed.revision,
    signal: { type: 'blocked', agent: 'qra_recovery_driver', detail: 'interrupt' },
    update: { pendingWork: [], failedWork: ['step-c'], activeAgents: [] },
    envelope: envelopeFor(checkpointed, 'op-ckpt-hostile-block', 'qra_recovery_driver', 'block_interrupted_mission'),
  });

  await assert.rejects(
    () => service.rollbackToCheckpoint({
      operationId: 'op-ckpt-hostile-missing',
      missionId: created.mission.id,
      expectedRevision: blocked.revision,
      checkpointId: 'ckpt-does-not-exist',
      envelope: envelopeFor(blocked, 'op-ckpt-hostile-missing', 'qra_recovery_driver', 'rollback_to_checkpoint'),
    }),
    /checkpoint not found/i,
  );
});
