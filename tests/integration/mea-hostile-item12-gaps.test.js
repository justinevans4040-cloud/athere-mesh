import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { MAX_BRANCHES } from '../../packages/mission/src/mission-checkpoints.js';
import { healMissionFromCheckpoint } from '../../packages/recovery/src/recovery-coordinator.js';

function clock() {
  return '2026-09-07T08:00:00.000Z';
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
    operationId: 'op-i12g-create',
    id: 'mission-i12g',
    objective: 'item12 gap close',
    goals: [{ id: 'g1', objective: 'G' }],
    subgoals: [
      { id: 'a', goalId: 'g1', objective: 'A' },
      { id: 'b', goalId: 'g1', objective: 'B' },
    ],
    dependencies: [{ prerequisite: 'a', dependent: 'b' }],
    currentPlan: { id: 'p1', version: 1, steps: ['a', 'b'] },
    constraints: ['proof'],
    permissions: [
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'nyx', actions: ['observe_repository', 'record_fact'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
      { actor: 'qra_recovery_driver', actions: [...RECOVERY_ACTIONS] },
    ],
    environmentObservations: [],
    ...overrides,
  };
}

function envelopeFor(record, operationId, agentId, action) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    action,
    objective: 'item12 gap',
    createdAt: clock(),
  });
}

async function seedCheckpoint(service, created) {
  const running = await service.transition({
    operationId: 'op-run',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: { evidence: [{ agent: 'nyx', note: 'work' }], activeAgents: ['nyx'] },
    envelope: envelopeFor(created, 'op-run', 'nyx'),
  });
  const certified = await service.transition({
    operationId: 'op-cert-a',
    missionId: created.mission.id,
    expectedRevision: running.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit' },
    update: { completedWork: ['a'], pendingWork: ['b'], activeAgents: [] },
    envelope: envelopeFor(running, 'op-cert-a', 'qra_emerge_audit'),
  });
  return service.createCheckpoint({
    operationId: 'op-cp',
    missionId: created.mission.id,
    expectedRevision: certified.revision,
    label: 'after-a',
    envelope: envelopeFor(certified, 'op-cp', 'qra_recovery_driver', 'create_checkpoint'),
  });
}

test('checkpoint selection exposes metadata but never embedded state snapshots', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-i12-select-cp-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({
    id: 'mission-i12-select-cp',
    operationId: 'op-select-cp-create',
  }));
  await seedCheckpoint(service, created);
  const selected = await service.select({
    missionId: created.mission.id,
    fields: ['checkpoints'],
  });
  assert.equal(selected.checkpoints.length, 1);
  assert.equal(selected.checkpoints[0].verified, true);
  assert.equal(selected.checkpoints[0].snapshot, undefined);
});

test('HOLE: poisoned authoritativeFacts must revert on retry_from_checkpoint', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-i12-facts-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({ id: 'mission-i12-facts', operationId: 'op-facts-create' }));
  const checkpointed = await seedCheckpoint(service, created);
  const facted = await service.recordFact({
    operationId: 'op-good-fact',
    missionId: created.mission.id,
    expectedRevision: checkpointed.revision,
    actor: 'nyx',
    fact: { id: 'fact-good', key: 'SERVER', value: 'good', status: 'current' },
    envelope: envelopeFor(checkpointed, 'op-good-fact', 'nyx', 'record_fact'),
  });
  // Re-checkpoint AFTER good fact so snapshot includes it? Or poison after checkpoint?
  // Gap-A: checkpoint BEFORE poison — retry must wipe poison.
  const afterGoodCp = await service.createCheckpoint({
    operationId: 'op-cp-good',
    missionId: created.mission.id,
    expectedRevision: facted.revision,
    label: 'with-good-fact',
    envelope: envelopeFor(facted, 'op-cp-good', 'qra_recovery_driver', 'create_checkpoint'),
  });
  const poisoned = await service.recordFact({
    operationId: 'op-poison',
    missionId: created.mission.id,
    expectedRevision: afterGoodCp.revision,
    actor: 'nyx',
    fact: { id: 'fact-poison', key: 'POISON', value: 'bad', status: 'current' },
    envelope: envelopeFor(afterGoodCp, 'op-poison', 'nyx', 'record_fact'),
  });
  assert.ok(poisoned.mission.authoritativeFacts.some((f) => f.id === 'fact-poison'));
  const blocked = await service.transition({
    operationId: 'op-block',
    missionId: created.mission.id,
    expectedRevision: poisoned.revision,
    signal: { type: 'blocked', agent: 'qra_recovery_driver', detail: 'poison path failed' },
    update: { pendingWork: [], failedWork: ['b'], activeAgents: [] },
    envelope: envelopeFor(poisoned, 'op-block', 'qra_recovery_driver', 'block_interrupted_mission'),
  });
  const goodCp = afterGoodCp.mission.checkpoints.find((c) => c.label === 'with-good-fact');
  const retried = await service.retryFromCheckpoint({
    operationId: 'op-retry',
    missionId: created.mission.id,
    expectedRevision: blocked.revision,
    checkpointId: goodCp.id,
    envelope: envelopeFor(blocked, 'op-retry', 'qra_recovery_driver', 'retry_from_checkpoint'),
  });
  assert.equal(retried.mission.status, 'running');
  assert.ok(retried.mission.authoritativeFacts.some((f) => f.id === 'fact-good'));
  assert.equal(
    retried.mission.authoritativeFacts.some((f) => f.id === 'fact-poison'),
    false,
    'HOLE: poisoned fact survived retry',
  );
  assert.deepEqual(retried.mission.completedWork, ['a']);
  assert.deepEqual(retried.mission.activeAgents, []);
});

test('HOLE: createBranch must fork live state back to checkpoint (not metadata-only)', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-i12-fork-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({ id: 'mission-i12-fork', operationId: 'op-fork-create' }));
  const checkpointed = await seedCheckpoint(service, created);
  const cp = checkpointed.mission.checkpoints[0];
  const diverged = await service.transition({
    operationId: 'op-diverge',
    missionId: created.mission.id,
    expectedRevision: checkpointed.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit' },
    update: { completedWork: ['a', 'b'], pendingWork: [], activeAgents: ['nyx'] },
    envelope: envelopeFor(checkpointed, 'op-diverge', 'qra_emerge_audit'),
  });
  assert.deepEqual(diverged.mission.completedWork, ['a', 'b']);
  await assert.rejects(
    () => service.createBranch({
      operationId: 'op-branch-running',
      missionId: created.mission.id,
      expectedRevision: diverged.revision,
      checkpointId: cp.id,
      strategy: 'alternate',
      envelope: envelopeFor(diverged, 'op-branch-running', 'qra_recovery_driver', 'create_branch'),
    }),
    /diverged running state|block the mission first/,
  );
  const blocked = await service.transition({
    operationId: 'op-block-fork',
    missionId: created.mission.id,
    expectedRevision: diverged.revision,
    signal: { type: 'blocked', agent: 'qra_recovery_driver', detail: 'diverge' },
    update: { activeAgents: [] },
    envelope: envelopeFor(diverged, 'op-block-fork', 'qra_recovery_driver', 'block_interrupted_mission'),
  });
  const branched = await service.createBranch({
    operationId: 'op-branch',
    missionId: created.mission.id,
    expectedRevision: blocked.revision,
    checkpointId: cp.id,
    strategy: 'alternate',
    envelope: envelopeFor(blocked, 'op-branch', 'qra_recovery_driver', 'create_branch'),
  });
  assert.deepEqual(branched.mission.completedWork, ['a']);
  assert.deepEqual(branched.mission.pendingWork, ['b']);
  assert.deepEqual(branched.mission.activeAgents, []);
  assert.equal(branched.mission.activeBranchId, branched.mission.branches[0].id);
  assert.ok(
    branched.mission.environmentObservations.some((o) => o.key === 'environment_resync' && o.value?.mode === 'branch'),
  );
});

test('HOLE: auto-heal must retry from branch origin checkpoint, not latest failed-path checkpoint', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-i12-origin-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({ id: 'mission-i12-origin', operationId: 'op-origin-create' }));
  const checkpointed = await seedCheckpoint(service, created);
  const origin = checkpointed.mission.checkpoints[0];
  const branched = await service.createBranch({
    operationId: 'op-br',
    missionId: created.mission.id,
    expectedRevision: checkpointed.revision,
    checkpointId: origin.id,
    strategy: 'alt',
    envelope: envelopeFor(checkpointed, 'op-br', 'qra_recovery_driver', 'create_branch'),
  });
  const failedPath = await service.transition({
    operationId: 'op-fail-cert',
    missionId: created.mission.id,
    expectedRevision: branched.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit' },
    update: { completedWork: ['a', 'b'], pendingWork: [], activeAgents: [] },
    envelope: envelopeFor(branched, 'op-fail-cert', 'qra_emerge_audit'),
  });
  const lateCp = await service.createCheckpoint({
    operationId: 'op-late-cp',
    missionId: created.mission.id,
    expectedRevision: failedPath.revision,
    label: 'failed-path-late',
    envelope: envelopeFor(failedPath, 'op-late-cp', 'qra_recovery_driver', 'create_checkpoint'),
  });
  assert.equal(lateCp.mission.checkpoints.length, 2);
  const markedFail = await service.transition({
    operationId: 'op-mark-fail',
    missionId: created.mission.id,
    expectedRevision: lateCp.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit' },
    update: {
      completedWork: ['a'],
      pendingWork: [],
      failedWork: ['b'],
      activeAgents: [],
    },
    envelope: envelopeFor(lateCp, 'op-mark-fail', 'qra_emerge_audit'),
  });
  const blocked = await service.transition({
    operationId: 'op-block2',
    missionId: created.mission.id,
    expectedRevision: markedFail.revision,
    signal: { type: 'blocked', agent: 'qra_recovery_driver', detail: 'alt failed' },
    update: { activeAgents: [] },
    envelope: envelopeFor(markedFail, 'op-block2', 'qra_recovery_driver', 'block_interrupted_mission'),
  });
  const heal = await healMissionFromCheckpoint({ root, missionId: created.mission.id, clock });
  assert.equal(heal.status, 'healed');
  assert.equal(heal.checkpointId, origin.id, 'HOLE: heal used latest failed-path checkpoint');
  const after = await service.get({ missionId: created.mission.id });
  assert.deepEqual(after.mission.completedWork, ['a']);
  assert.equal(after.mission.activeBranchId, 'main');
});

test('HOLE: branches must enforce the same hard cap as checkpoints', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-i12-cap-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({ id: 'mission-i12-cap', operationId: 'op-cap-create' }));
  let record = await seedCheckpoint(service, created);
  const cp = record.mission.checkpoints[0];
  for (let i = 0; i < MAX_BRANCHES; i += 1) {
    record = await service.createBranch({
      operationId: `op-br-${i}`,
      missionId: created.mission.id,
      expectedRevision: record.revision,
      checkpointId: cp.id,
      strategy: `s-${i}`,
      envelope: envelopeFor(record, `op-br-${i}`, 'qra_recovery_driver', 'create_branch'),
    });
  }
  assert.equal(record.mission.branches.length, MAX_BRANCHES);
  await assert.rejects(
    () => service.createBranch({
      operationId: 'op-br-overflow',
      missionId: created.mission.id,
      expectedRevision: record.revision,
      checkpointId: cp.id,
      strategy: 'overflow',
      envelope: envelopeFor(record, 'op-br-overflow', 'qra_recovery_driver', 'create_branch'),
    }),
    /branches exceed cap/,
  );
});
