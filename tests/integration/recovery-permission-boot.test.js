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
    update: { activeAgents: ['nyx'] },
    envelope: createAgentOperationEnvelope({
      record: created,
      operationId: 'op-recovery-idem-run',
      agentId: 'nyx',
      objective: 'start',
      createdAt: clock(),
    }),
  });

  // Plant a prior recovery-block operation id with different content hash so
  // the stable recovery op id conflicts on the next converge attempt.
  const planted = Object.freeze({
    revision: running.revision,
    mission: Object.freeze({
      ...running.mission,
      transitionHistory: Object.freeze([
        ...(running.mission.transitionHistory ?? []),
        Object.freeze({
          transitionId: `${running.mission.id}-transition-planted`,
          stateVersion: running.revision + 1,
          previousVersion: running.revision,
          previousTransitionHash: 'c'.repeat(64),
          transitionHash: 'd'.repeat(64),
          operationId: `${running.mission.id}-recovery-block`,
          actor: 'qra_recovery_driver',
          action: 'block_interrupted_mission',
          timestamp: clock(),
          input: { planted: true, differentPayload: true },
          authorization: Object.freeze({ allowed: true }),
          evidence: null,
          stateHash: 'e'.repeat(64),
          previousStateHash: 'f'.repeat(64),
          changes: Object.freeze({}),
        }),
      ]),
    }),
  });
  await service.store?.saveMission?.({ mission: planted.mission, expectedRevision: running.revision }).catch(() => {});

  // Direct filesystem/default store write via reconstructing service store:
  const shared = new Map([[planted.mission.id, planted]]);
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

  const result = await recoverAndHealMissions({ root, missionStore: store });
  assert.ok(Array.isArray(result.recovered));
  assert.equal(typeof shared.get(planted.mission.id).mission.status, 'string');
});
