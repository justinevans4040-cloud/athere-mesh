import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMission } from '../../packages/contracts/src/mission.js';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { recoverAndHealMissions } from '../../packages/recovery/src/recovery-coordinator.js';
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
  assert.equal(shared.get(mission.id).mission.status, 'accepted');
  assert.equal(shared.get(mission.id).revision, 1);
});

test('recoverAndHeal does not abort boot on recovery idempotency conflict', async () => {
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
      { actor: 'qra_recovery_driver', actions: ['block_interrupted_mission'] },
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

  // First recovery consumes the stable recovery-block operation id.
  const shared = new Map([[running.mission.id, running]]);
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

  const first = await recoverAndHealMissions({ root, missionStore: store, clock });
  assert.deepEqual(first.recovered, [running.mission.id]);
  assert.equal(shared.get(running.mission.id).mission.status, 'blocked');

  // Resume to running with different pendingWork, then recover again. Stable
  // recovery op id collides with the prior block payload → soft-fail, no boot abort.
  const blocked = shared.get(running.mission.id);
  const resumed = await createMissionStateService({ root, clock, store }).transition({
    operationId: 'op-recovery-idem-resume',
    missionId: blocked.mission.id,
    expectedRevision: blocked.revision,
    signal: { type: 'running', agent: 'miss-vale-prime', detail: 'resume after interrupt' },
    update: { activeAgents: ['miss-vale-prime'], pendingWork: ['inspect-repository'], failedWork: [] },
    envelope: createAgentOperationEnvelope({
      record: blocked,
      operationId: 'op-recovery-idem-resume',
      agentId: 'miss-vale-prime',
      objective: 'resume',
      createdAt: clock(),
    }),
  });
  shared.set(resumed.mission.id, resumed);

  const result = await recoverAndHealMissions({ root, missionStore: store, clock });
  assert.ok(Array.isArray(result.recovered));
  assert.equal(typeof shared.get(resumed.mission.id).mission.status, 'string');
});
