import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { createMissionStoreBridge, defaultMissionStore } from '../../packages/mission/src/mission-store.js';

const clock = () => '2026-09-05T21:40:00.000Z';

test('HOLE: tampered transition ledger must fail closed on transition load', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-p123-ledger-'));
  let tamper = false;
  const store = createMissionStoreBridge({
    saveMission: defaultMissionStore.saveMission,
    async loadMission(options) {
      const record = await defaultMissionStore.loadMission(options);
      if (!tamper) return record;
      const history = structuredClone(record.mission.transitionHistory);
      history[0].actor = 'intruder';
      return { ...record, mission: { ...record.mission, transitionHistory: history } };
    },
  });
  const service = createMissionStateService({ root, clock, store });
  const created = await service.create({
    operationId: 'op-ledger-create',
    id: 'mission-ledger-1',
    objective: 'ledger integrity',
    goals: [{ id: 'g1', objective: 'g' }],
    subgoals: [{ id: 'inspect', goalId: 'g1', objective: 'i' }],
    dependencies: [],
    constraints: [],
    permissions: [{ actor: 'nyx', actions: ['observe_repository'] }],
    currentPlan: { id: 'p1', version: 1, steps: ['inspect'] },
    environmentObservations: [],
  });
  tamper = true;
  await assert.rejects(
    () => service.transition({
      operationId: 'op-ledger-nyx',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx', detail: 'after tamper' },
      update: { evidence: [{ agent: 'nyx' }], activeAgents: ['nyx'] },
      envelope: createAgentOperationEnvelope({
        record: created,
        operationId: 'op-ledger-nyx',
        agentId: 'nyx',
        objective: 'tamper',
        createdAt: clock(),
      }),
    }),
    /transition hash mismatch|history verification failed|tamper/i,
  );
});
