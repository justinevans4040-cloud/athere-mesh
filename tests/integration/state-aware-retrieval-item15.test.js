import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

function clock() {
  return '2026-09-04T18:30:00.000Z';
}

function createInput(overrides = {}) {
  return {
    operationId: 'op-ret-create-1',
    id: 'mission-ret-svc-1',
    objective: 'state-aware retrieval mission',
    goals: [{ id: 'goal-1', objective: 'Keep IP current' }],
    subgoals: [
      { id: 'step-a', goalId: 'goal-1', objective: 'A' },
      { id: 'step-b', goalId: 'goal-1', objective: 'B' },
    ],
    dependencies: [{ prerequisite: 'step-a', dependent: 'step-b' }],
    currentPlan: { id: 'plan-1', version: 1, steps: ['step-a', 'step-b'] },
    constraints: ['completion requires independently verified proof'],
    permissions: [
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
      { actor: 'fact-keeper', actions: ['record_fact', 'supersede_fact'] },
      {
        actor: 'qra_recovery_driver',
        actions: [
          'block_interrupted_mission',
          'create_checkpoint',
          'create_branch',
          'quarantine_branch',
          'rollback_to_checkpoint',
          'retry_from_checkpoint',
        ],
      },
    ],
    environmentObservations: [
      { source: 'titan', key: 'repository_root', value: '/tmp/repo', observedAt: clock() },
    ],
    authoritativeFacts: [
      { id: 'fact-ip-1', key: 'SERVER_IP', value: '10.0.0.1', status: 'current' },
    ],
    ...overrides,
  };
}

test('Item 15: service retrieveMemory prefers current fact over superseded similar key', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-ret-15-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput());
  await service.supersedeFact({
    operationId: 'op-ret-supersede',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    actor: 'fact-keeper',
    factId: 'fact-ip-1',
    successor: { id: 'fact-ip-2', value: '10.0.0.9' },
    reason: 'rotated',
  });

  const result = await service.retrieveMemory({
    missionId: created.mission.id,
    reader: 'orchestrator',
    query: {
      key: 'SERVER_IP',
      text: 'SERVER_IP for titan host',
      goalId: 'goal-1',
    },
  });

  assert.equal(result.selected.content.id, 'fact-ip-2');
  assert.equal(result.selected.validationState, 'current');
  assert.equal(result.selected.mayOverrideCurrent, false);
  assert.ok(result.candidates.every((entry) => entry.mayOverrideCurrent !== true));
  assert.equal(result.selected.content.valueRedacted, true);
});

test('Item 15: retrieveMemory rejects unauthorized reader and result over-cap', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-ret-15b-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({
    id: 'mission-ret-svc-2',
    operationId: 'op-ret-create-2',
  }));

  await assert.rejects(
    () => service.retrieveMemory({
      missionId: created.mission.id,
      reader: 'nyx',
      query: { key: 'SERVER_IP' },
    }),
    /unauthorized memory reader/,
  );

  await assert.rejects(
    () => service.retrieveMemory({
      missionId: created.mission.id,
      reader: 'auditor',
      query: { key: 'SERVER_IP' },
      limit: 0,
    }),
    /retrieval limit/,
  );
});
