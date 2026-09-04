import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { MEMORY_TYPES } from '../../packages/memory/src/typed-memory.js';

function clock() {
  return '2026-09-04T16:00:00.000Z';
}

function createInput(overrides = {}) {
  return {
    operationId: 'op-mem-create-1',
    id: 'mission-mem-svc-1',
    objective: 'typed memory mission',
    goals: [{ id: 'goal-1', objective: 'Reach the end' }],
    subgoals: [
      { id: 'step-a', goalId: 'goal-1', objective: 'A' },
      { id: 'step-b', goalId: 'goal-1', objective: 'B' },
    ],
    dependencies: [{ prerequisite: 'step-a', dependent: 'step-b' }],
    currentPlan: { id: 'plan-1', version: 1, steps: ['step-a', 'step-b'] },
    constraints: ['completion requires independently verified proof'],
    permissions: [
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'nyx', actions: ['observe_repository', 'record_fact', 'supersede_fact'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
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

test('Item 14: mission service projects typed memory and rejects forge via transition', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-mem-14-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput());
  const memory = await service.memory({ missionId: created.mission.id, reader: 'orchestrator' });
  assert.equal(memory.missionId, created.mission.id);
  for (const type of MEMORY_TYPES) {
    assert.ok(Array.isArray(memory[type]), type);
  }
  assert.ok(memory.working.some((entry) => entry.content?.objective === 'typed memory mission'));
  assert.ok(memory.semantic.some((entry) => entry.content?.key === 'SERVER_IP' && entry.validationState === 'current'));
  assert.ok(memory.procedural.some((entry) => entry.memoryType === 'procedural'));
  assert.ok(memory.state_history.length >= 1);

  await assert.rejects(
    () => service.memory({ missionId: created.mission.id, reader: 'nyx' }),
    /unauthorized memory reader/,
  );

  await assert.rejects(
    () => service.transition({
      operationId: 'op-mem-forge',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'miss-vale-prime' },
      update: {
        memory: { working: [], semantic: [] },
        activeAgents: ['miss-vale-prime'],
      },
      envelope: envelopeFor(created, 'op-mem-forge', 'miss-vale-prime'),
    }),
    /unauthorized memory writer|memory must not be mutated/,
  );
});

test('Item 14: superseded semantic fact is not current working state', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-mem-14s-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({
    id: 'mission-mem-svc-2',
    operationId: 'op-mem-create-2',
  }));
  const superseded = await service.supersedeFact({
    operationId: 'op-mem-supersede',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    actor: 'nyx',
    factId: 'fact-ip-1',
    successor: { id: 'fact-ip-2', value: '10.0.0.2' },
    reason: 'rotated address',
  });
  const memory = await service.memory({ missionId: created.mission.id, reader: 'auditor' });
  const currentSemantic = memory.semantic.filter((entry) => entry.validationState === 'current');
  const historicalSemantic = memory.semantic.filter((entry) => entry.validationState === 'superseded');
  assert.equal(currentSemantic.length, 1);
  assert.equal(currentSemantic[0].content.key, 'SERVER_IP');
  assert.equal(currentSemantic[0].content.valueRedacted, true);
  assert.equal(currentSemantic[0].content.value, undefined);
  assert.ok(historicalSemantic.some((entry) => entry.content.id === 'fact-ip-1' && entry.content.valueRedacted === true));
  assert.ok(!memory.working.some((entry) => entry.content?.key === 'SERVER_IP'));
  assert.equal(superseded.mission.authoritativeFacts.find((f) => f.id === 'fact-ip-2').status, 'current');

  const filtered = await service.memory({
    missionId: created.mission.id,
    reader: 'mission-state-service',
    types: ['semantic', 'procedural'],
  });
  assert.ok(filtered.semantic);
  assert.ok(filtered.procedural);
  assert.equal(filtered.working, undefined);
});
