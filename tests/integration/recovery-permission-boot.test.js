import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMission } from '../../packages/contracts/src/mission.js';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { recoverAndHealMissions, recoverInterruptedMissions } from '../../packages/recovery/src/recovery-coordinator.js';
import { createMissionStoreBridge } from '../../packages/mission/src/mission-store.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

const clock = () => '2026-09-05T21:00:00.000Z';

test('recoverAndHeal does not abort boot when a shared mission lacks recovery permission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'athere-recovery-perm-'));
  const base = createMission({
    id: 'mission-no-recovery-perm',
    intent: 'test all of Titan',
    clock: () => '2026-09-05T21:00:00.000Z',
  });
  // Non-empty permissions without recovery actor — denies legacy empty-permissions bypass.
  const mission = Object.freeze({
    ...base,
    permissions: Object.freeze([
      Object.freeze({ actor: 'nyx', actions: Object.freeze(['observe_repository']) }),
    ]),
  });
  assert.equal(mission.status, 'accepted');

  const shared = new Map([
    [mission.id, Object.freeze({ revision: 1, mission })],
  ]);
  const store = createMissionStoreBridge({
    async listMissionIds() {
      return Object.freeze([...shared.keys()].sort());
    },
    async loadMission({ missionId }) {
      const record = shared.get(missionId);
      if (!record) throw new Error('mission snapshot not found');
      return record;
    },
    async saveMission({ mission: next, expectedRevision }) {
      const current = shared.get(next.id);
      const currentRevision = current?.revision ?? 0;
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        throw new Error(`revision conflict: expected ${expectedRevision}, found ${currentRevision}`);
      }
      const record = Object.freeze({ revision: currentRevision + 1, mission: next });
      shared.set(next.id, record);
      return record;
    },
  });

  const result = await recoverAndHealMissions({ root, missionStore: store });
  assert.deepEqual(result.recovered, []);
  assert.ok(result.corrupt.some(({ missionId, reason }) => (
    missionId === mission.id && /missing recovery permission/.test(reason)
  )));
  assert.equal(shared.get(mission.id).mission.status, 'accepted');
});

test('F5: empty permissions deny recovery block_interrupted_mission on shared store', async () => {
  const root = await mkdtemp(join(tmpdir(), 'athere-recovery-empty-perm-'));
  const base = createMission({
    id: 'mission-empty-perm',
    intent: 'empty permissions deny recovery',
    clock: () => '2026-09-05T21:00:00.000Z',
  });
  const mission = Object.freeze({
    ...base,
    permissions: Object.freeze([]),
  });
  const shared = new Map([
    [mission.id, Object.freeze({ revision: 1, mission })],
  ]);
  const store = createMissionStoreBridge({
    async listMissionIds() {
      return Object.freeze([...shared.keys()].sort());
    },
    async loadMission({ missionId }) {
      const record = shared.get(missionId);
      if (!record) throw new Error('mission snapshot not found');
      return record;
    },
    async saveMission({ mission: next, expectedRevision }) {
      const current = shared.get(next.id);
      const currentRevision = current?.revision ?? 0;
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        throw new Error(`revision conflict: expected ${expectedRevision}, found ${currentRevision}`);
      }
      const record = Object.freeze({ revision: currentRevision + 1, mission: next });
      shared.set(next.id, record);
      return record;
    },
  });

  const result = await recoverAndHealMissions({ root, missionStore: store });
  assert.deepEqual(result.recovered, []);
  assert.ok(result.corrupt.some(({ missionId, reason }) => (
    missionId === mission.id && /missing recovery permission/.test(reason)
  )));
  assert.equal(shared.get(mission.id).mission.status, 'accepted');
  assert.equal(shared.get(mission.id).revision, 1);
});

test('repeated interruptions use revision-bound recovery IDs and block again', async () => {
  const root = await mkdtemp(join(tmpdir(), 'athere-recovery-idem-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create({
    operationId: 'op-recovery-idem-create',
    id: 'mission-recovery-idem',
    objective: 'recovery idempotency soft-fail',
    goals: [{ id: 'goal-1', objective: 'g' }],
    subgoals: [{ id: 'inspect-repository', objective: 'Inspect', goalId: 'goal-1' }],
    dependencies: [],
    constraints: [],
    permissions: [
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
      {
        actor: 'qra_recovery_driver',
        actions: [
          'block_interrupted_mission',
          'create_checkpoint',
          'retry_from_checkpoint',
        ],
      },
    ],
    currentPlan: { id: 'plan-1', version: 1, steps: ['inspect-repository'] },
    environmentObservations: [{ source: 't', key: 'k', value: true, observedAt: clock() }],
  });

  const running = await service.transition({
    operationId: 'op-recovery-idem-run',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'start' },
    update: { activeAgents: ['nyx'], pendingWork: ['inspect-repository'] },
    envelope: createAgentOperationEnvelope({
      record: created,
      operationId: 'op-recovery-idem-run',
      agentId: 'nyx',
      objective: 'start',
      createdAt: clock(),
    }),
  });

  const checkpointed = await service.createCheckpoint({
    operationId: 'op-recovery-idem-cp',
    missionId: running.mission.id,
    expectedRevision: running.revision,
    label: 'pre-interrupt',
    envelope: createAgentOperationEnvelope({
      record: running,
      operationId: 'op-recovery-idem-cp',
      agentId: 'qra_recovery_driver',
      action: 'create_checkpoint',
      objective: 'checkpoint before interrupt',
      createdAt: clock(),
    }),
  });

  // First recovery consumes the recovery-block operation ID for this revision.
  const shared = new Map([[checkpointed.mission.id, checkpointed]]);
  const store = createMissionStoreBridge({
    async listMissionIds() {
      return Object.freeze([...shared.keys()]);
    },
    async loadMission({ missionId }) {
      return shared.get(missionId);
    },
    async saveMission({ mission: next, expectedRevision }) {
      const current = shared.get(next.id);
      const currentRevision = current?.revision ?? 0;
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        throw new Error(`revision conflict: expected ${expectedRevision}, found ${currentRevision}`);
      }
      const record = Object.freeze({ revision: currentRevision + 1, mission: next });
      shared.set(next.id, record);
      return record;
    },
  });

  const first = await recoverInterruptedMissions({ root, missionStore: store, clock });
  assert.deepEqual(first.recovered, [checkpointed.mission.id]);
  assert.equal(shared.get(checkpointed.mission.id).mission.status, 'blocked');

  // Honest resume via checkpoint, then diverge and recover again. The later
  // revision receives a distinct recovery ID and cannot be stranded running.
  const blocked = shared.get(checkpointed.mission.id);
  const resumed = await createMissionStateService({ root, clock, store }).retryFromCheckpoint({
    operationId: 'op-recovery-idem-retry',
    missionId: blocked.mission.id,
    expectedRevision: blocked.revision,
    checkpointId: checkpointed.mission.checkpoints[0].id,
    envelope: createAgentOperationEnvelope({
      record: blocked,
      operationId: 'op-recovery-idem-retry',
      agentId: 'qra_recovery_driver',
      action: 'retry_from_checkpoint',
      objective: 'resume via checkpoint',
      createdAt: clock(),
    }),
  });
  const diverged = await createMissionStateService({ root, clock, store }).transition({
    operationId: 'op-recovery-idem-diverge',
    missionId: resumed.mission.id,
    expectedRevision: resumed.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'different pending set' },
    update: { activeAgents: ['nyx'], pendingWork: [], failedWork: ['inspect-repository'] },
    envelope: createAgentOperationEnvelope({
      record: resumed,
      operationId: 'op-recovery-idem-diverge',
      agentId: 'nyx',
      objective: 'diverge partitions',
      createdAt: clock(),
    }),
  });
  shared.set(diverged.mission.id, diverged);

  const result = await recoverAndHealMissions({ root, missionStore: store, clock });
  assert.deepEqual(result.recovered, [diverged.mission.id]);
  assert.deepEqual(result.healed, [diverged.mission.id]);
  assert.equal(shared.get(diverged.mission.id).mission.status, 'running');
  assert.ok(shared.get(diverged.mission.id).mission.transitionHistory.some(({ operationId }) => (
    operationId === `${diverged.mission.id}-recovery-block-v${diverged.revision}`
  )));
});
