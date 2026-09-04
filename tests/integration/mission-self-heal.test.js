import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import {
  healBlockedMissionsFromCheckpoints,
  recoverAndHealMissions,
  recoverInterruptedMissions,
} from '../../packages/recovery/src/recovery-coordinator.js';

function clock() {
  return '2026-09-04T10:00:00.000Z';
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
    operationId: 'op-heal-create',
    id: 'mission-heal-1',
    objective: 'self-heal durable mission',
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
      { actor: 'nyx', actions: ['observe_repository'] },
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
    objective: `${agentId} ${action ?? 'op'}`,
    createdAt: clock(),
  });
}

async function seedCheckpointedThenBlocked(service, created) {
  const supervised = await service.transition({
    operationId: `${created.mission.id}-mgr`,
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'miss-vale-prime' },
    update: { activeAgents: ['miss-vale-prime'] },
    envelope: envelopeFor(created, `${created.mission.id}-mgr`, 'miss-vale-prime'),
  });
  const performed = await service.transition({
    operationId: `${created.mission.id}-nyx`,
    missionId: created.mission.id,
    expectedRevision: supervised.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: { evidence: [{ agent: 'nyx', ok: true }], activeAgents: ['nyx'] },
    envelope: envelopeFor(supervised, `${created.mission.id}-nyx`, 'nyx'),
  });
  const certified = await service.transition({
    operationId: `${created.mission.id}-cert`,
    missionId: created.mission.id,
    expectedRevision: performed.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit' },
    update: { completedWork: ['a'], pendingWork: ['b'], activeAgents: [] },
    envelope: envelopeFor(performed, `${created.mission.id}-cert`, 'qra_emerge_audit'),
  });
  const checkpointed = await service.createCheckpoint({
    operationId: `${created.mission.id}-ckpt`,
    missionId: created.mission.id,
    expectedRevision: certified.revision,
    label: 'after-a',
    envelope: envelopeFor(certified, `${created.mission.id}-ckpt`, 'qra_recovery_driver', 'create_checkpoint'),
  });
  const branched = await service.createBranch({
    operationId: `${created.mission.id}-branch`,
    missionId: created.mission.id,
    expectedRevision: checkpointed.revision,
    checkpointId: checkpointed.mission.checkpoints[0].id,
    strategy: 'failing-approach',
    envelope: envelopeFor(checkpointed, `${created.mission.id}-branch`, 'qra_recovery_driver', 'create_branch'),
  });
  const blocked = await service.transition({
    operationId: `${created.mission.id}-block`,
    missionId: created.mission.id,
    expectedRevision: branched.revision,
    signal: { type: 'blocked', agent: 'qra_recovery_driver', detail: 'interrupted execution requires operator retry' },
    update: { pendingWork: [], failedWork: ['b'], activeAgents: [] },
    envelope: envelopeFor(branched, `${created.mission.id}-block`, 'qra_recovery_driver', 'block_interrupted_mission'),
  });
  return { checkpointed, blocked };
}

test('healBlockedMissionsFromCheckpoints quarantines failed branch and resumes from last verified checkpoint', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-heal-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput());
  await seedCheckpointedThenBlocked(service, created);

  const heal = await healBlockedMissionsFromCheckpoints({ root, clock });
  assert.deepEqual(heal.healed, [created.mission.id]);
  assert.equal(heal.unhealed.length, 0);

  const after = await service.get({ missionId: created.mission.id });
  assert.equal(after.mission.status, 'running');
  assert.deepEqual(after.mission.completedWork, ['a']);
  assert.deepEqual(after.mission.pendingWork, ['b']);
  assert.deepEqual(after.mission.failedWork, []);
  assert.equal(after.mission.branches[0].status, 'quarantined');
  assert.equal(after.mission.activeBranchId, 'main');
  assert.ok(after.mission.environmentObservations.some((obs) => obs.key === 'environment_resync'));
});

test('heal skips blocked missions with no checkpoint; recoverAndHeal blocks then heals when checkpoint exists', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-heal-combo-'));
  const service = createMissionStateService({ root, clock });

  const noCkpt = await service.create(createInput({
    id: 'mission-heal-none',
    operationId: 'op-heal-none-create',
  }));
  await service.transition({
    operationId: 'op-heal-none-run',
    missionId: noCkpt.mission.id,
    expectedRevision: noCkpt.revision,
    signal: { type: 'running', agent: 'miss-vale-prime' },
    update: { activeAgents: ['miss-vale-prime'] },
    envelope: envelopeFor(noCkpt, 'op-heal-none-run', 'miss-vale-prime'),
  });

  const withCkpt = await service.create(createInput({
    id: 'mission-heal-yes',
    operationId: 'op-heal-yes-create',
  }));
  await seedCheckpointedThenBlocked(service, withCkpt);

  const result = await recoverAndHealMissions({ root, clock });
  assert.ok(result.recovered.includes('mission-heal-none'));
  assert.deepEqual(result.healed, ['mission-heal-yes']);
  assert.equal((await service.get({ missionId: 'mission-heal-none' })).mission.status, 'blocked');
  assert.equal((await service.get({ missionId: 'mission-heal-yes' })).mission.status, 'running');
});

test('auto-heal stops after the heal attempt cap to prevent infinite rollback loops', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-heal-cap-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({ id: 'mission-heal-cap', operationId: 'op-heal-cap-create' }));
  await seedCheckpointedThenBlocked(service, created);

  for (let i = 0; i < 3; i += 1) {
    const heal = await healBlockedMissionsFromCheckpoints({ root, clock });
    assert.deepEqual(heal.healed, [created.mission.id]);
    const running = await service.get({ missionId: created.mission.id });
    assert.equal(running.mission.status, 'running');
    await service.transition({
      operationId: `op-heal-cap-reblock-${i}`,
      missionId: created.mission.id,
      expectedRevision: running.revision,
      signal: { type: 'blocked', agent: 'qra_recovery_driver', detail: 'interrupted execution requires operator retry' },
      update: { pendingWork: [], failedWork: ['b'], activeAgents: [] },
      envelope: envelopeFor(running, `op-heal-cap-reblock-${i}`, 'qra_recovery_driver', 'block_interrupted_mission'),
    });
  }

  const finalHeal = await healBlockedMissionsFromCheckpoints({ root, clock });
  assert.equal(finalHeal.healed.length, 0);
  assert.ok(finalHeal.unhealed.some((entry) => entry.missionId === created.mission.id && /heal cap/i.test(entry.reason)));
  assert.equal((await service.get({ missionId: created.mission.id })).mission.status, 'blocked');
});
