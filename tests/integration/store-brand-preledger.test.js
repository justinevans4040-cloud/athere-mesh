import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { authorizeCompletedWorkClaim } from '../../packages/contracts/src/execution-roles.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { createMissionStoreBridge, isBrandedMissionStore } from '../../packages/mission/src/mission-store.js';

test('authorizeCompletedWorkClaim rejects pre-ledger missions with empty transitionHistory', () => {
  assert.throws(
    () => authorizeCompletedWorkClaim({
      agentId: 'qra_emerge_audit',
      transitionHistory: [],
      update: { completedWork: ['inspect'] },
    }),
    /pre-ledger mission without transition history/,
  );
});

test('createMissionStateService rejects unbranded store injection', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-store-brand-'));
  const hostile = {
    async loadMission() { throw new Error('hostile load'); },
    async saveMission() { throw new Error('hostile save'); },
  };
  assert.equal(isBrandedMissionStore(hostile), false);
  assert.throws(
    () => createMissionStateService({ root, store: hostile }),
    /branded mission store/,
  );
});

test('createMissionStoreBridge brands hermetic adapters for service composition', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-store-bridge-'));
  const shared = new Map();
  const store = createMissionStoreBridge({
    async loadMission({ missionId }) {
      const record = shared.get(missionId);
      if (!record) throw new Error('mission snapshot not found');
      return record;
    },
    async saveMission({ mission, expectedRevision }) {
      const current = shared.get(mission.id);
      const currentRevision = current?.revision ?? 0;
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        throw new Error(`revision conflict: expected ${expectedRevision}, found ${currentRevision}`);
      }
      const record = Object.freeze({ revision: currentRevision + 1, mission });
      shared.set(mission.id, record);
      return record;
    },
    async listMissionIds() {
      return Object.freeze([...shared.keys()].sort());
    },
  });
  assert.equal(isBrandedMissionStore(store), true);
  const service = createMissionStateService({ root, store });
  const created = await service.create({
    operationId: 'op-bridge-create',
    id: 'mission-bridge-1',
    objective: 'bridge store works',
    goals: [{ id: 'goal-1', objective: 'g' }],
    subgoals: [{ id: 'inspect', objective: 'Inspect', goalId: 'goal-1' }],
    dependencies: [],
    constraints: [],
    permissions: [
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
    ],
    currentPlan: { id: 'plan-1', version: 1, steps: ['inspect'] },
    environmentObservations: [{ source: 'runtime', key: 'bridge', value: true, observedAt: '2026-09-05T00:00:00.000Z' }],
  });
  assert.equal(created.mission.id, 'mission-bridge-1');
  assert.ok(createAgentOperationEnvelope);
});
