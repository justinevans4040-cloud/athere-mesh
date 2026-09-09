import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { createMissionStoreBridge, defaultMissionStore } from '../../packages/mission/src/mission-store.js';
import { recoverInterruptedMissions } from '../../packages/recovery/src/recovery-coordinator.js';

function clock() {
  return '2026-09-07T10:00:00.000Z';
}

const RECOVERY = [
  'block_interrupted_mission',
  'create_checkpoint',
  'create_branch',
  'quarantine_branch',
  'rollback_to_checkpoint',
  'retry_from_checkpoint',
];

function input(overrides = {}) {
  return {
    operationId: 'op-sec-create',
    id: 'mission-i12-sec',
    objective: 'item12 security',
    goals: [{ id: 'g1', objective: 'g' }],
    subgoals: [
      { id: 'a', goalId: 'g1', objective: 'A' },
      { id: 'b', goalId: 'g1', objective: 'B' },
    ],
    dependencies: [{ prerequisite: 'a', dependent: 'b' }],
    currentPlan: { id: 'p', version: 1, steps: ['a', 'b'] },
    constraints: [],
    environmentObservations: [],
    permissions: [
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
      { actor: 'qra_recovery_driver', actions: [...RECOVERY] },
    ],
    ...overrides,
  };
}

function env(record, operationId, agentId, action) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    action,
    objective: 'sec',
    createdAt: clock(),
  });
}

async function seeded(root, id) {
  const service = createMissionStateService({ root, clock });
  const created = await service.create(input({ id, operationId: `c-${id}` }));
  const nyx = await service.transition({
    operationId: 'n',
    missionId: id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: { evidence: [{ agent: 'nyx', note: 'w' }], activeAgents: ['nyx'] },
    envelope: env(created, 'n', 'nyx'),
  });
  const cert = await service.transition({
    operationId: 'cert',
    missionId: id,
    expectedRevision: nyx.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit' },
    update: { completedWork: ['a'], pendingWork: ['b'], activeAgents: [] },
    envelope: env(nyx, 'cert', 'qra_emerge_audit'),
  });
  const cp = await service.createCheckpoint({
    operationId: 'cp',
    missionId: id,
    expectedRevision: cert.revision,
    label: 'good',
    envelope: env(cert, 'cp', 'qra_recovery_driver', 'create_checkpoint'),
  });
  return { service, created, cp };
}

test('I12A1: create_branch must not rewind diverged running work', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-i12a1-'));
  const { service, cp } = await seeded(root, 'mission-i12a1');
  const diverged = await service.transition({
    operationId: 'div',
    missionId: 'mission-i12a1',
    expectedRevision: cp.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit' },
    update: { completedWork: ['a', 'b'], pendingWork: [], activeAgents: [] },
    envelope: env(cp, 'div', 'qra_emerge_audit'),
  });
  await assert.rejects(
    () => service.createBranch({
      operationId: 'br',
      missionId: 'mission-i12a1',
      expectedRevision: diverged.revision,
      checkpointId: cp.mission.checkpoints[0].id,
      strategy: 'steal',
      envelope: env(diverged, 'br', 'qra_recovery_driver', 'create_branch'),
    }),
    /diverged running state/,
  );
  assert.deepEqual((await service.get({ missionId: 'mission-i12a1' })).mission.completedWork, ['a', 'b']);
});

test('I12A2: rollback without quarantine must clear active failed branch', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-i12a2-'));
  const { service, cp } = await seeded(root, 'mission-i12a2');
  const branched = await service.createBranch({
    operationId: 'br',
    missionId: 'mission-i12a2',
    expectedRevision: cp.revision,
    checkpointId: cp.mission.checkpoints[0].id,
    strategy: 'alt',
    envelope: env(cp, 'br', 'qra_recovery_driver', 'create_branch'),
  });
  const blocked = await service.transition({
    operationId: 'blk',
    missionId: 'mission-i12a2',
    expectedRevision: branched.revision,
    signal: { type: 'blocked', agent: 'qra_recovery_driver', detail: 'fail' },
    update: { activeAgents: [] },
    envelope: env(branched, 'blk', 'qra_recovery_driver', 'block_interrupted_mission'),
  });
  const rolled = await service.rollbackToCheckpoint({
    operationId: 'roll',
    missionId: 'mission-i12a2',
    expectedRevision: blocked.revision,
    checkpointId: cp.mission.checkpoints[0].id,
    envelope: env(blocked, 'roll', 'qra_recovery_driver', 'rollback_to_checkpoint'),
  });
  assert.equal(rolled.mission.activeBranchId, 'main');
  assert.equal(rolled.mission.branches[0].status, 'quarantined');
});

test('I12A4: corrupt mission ledger must not abort fleet recovery', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-i12a4-'));
  await seeded(root, 'mission-i12a4-good');

  const honest = createMissionStateService({ root, clock });
  await honest.create(input({ id: 'mission-i12a4-bad', operationId: 'c-bad' }));

  const store = createMissionStoreBridge({
    saveMission: defaultMissionStore.saveMission,
    listMissionIds: defaultMissionStore.listMissionIds,
    async loadMission(options) {
      const record = await defaultMissionStore.loadMission(options);
      if (options.missionId === 'mission-i12a4-bad') {
        const history = structuredClone(record.mission.transitionHistory ?? []);
        if (history[0]) history[0].actor = 'intruder';
        return { ...record, mission: { ...record.mission, transitionHistory: history } };
      }
      return record;
    },
  });

  const recovery = await recoverInterruptedMissions({ root, clock, missionStore: store });
  assert.ok(!recovery.recovered.includes('mission-i12a4-bad'));
  assert.ok(
    (recovery.corrupt ?? []).some((entry) => entry?.missionId === 'mission-i12a4-bad'),
    `expected corrupt entry for bad mission, got ${JSON.stringify(recovery.corrupt)}`,
  );
  assert.ok(
    recovery.recovered.includes('mission-i12a4-good'),
    `good mission must still recover; recovered=${JSON.stringify(recovery.recovered)}`,
  );
});
