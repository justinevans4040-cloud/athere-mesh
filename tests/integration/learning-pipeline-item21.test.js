import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { createGatedLearningPipeline } from '../../packages/learning/src/gated-learning-pipeline.js';

function clock() {
  return '2026-09-04T23:00:00.000Z';
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
    operationId: 'op-learn-create-1',
    id: 'mission-learn-1',
    objective: 'learning pipeline mission',
    goals: [{ id: 'goal-1', objective: 'Reach the end' }],
    subgoals: [
      { id: 'inspect-repository', goalId: 'goal-1', objective: 'Inspect' },
      { id: 'run-node-tests', goalId: 'goal-1', objective: 'Test' },
      { id: 'verify-proof', goalId: 'goal-1', objective: 'Verify' },
    ],
    dependencies: [
      { prerequisite: 'inspect-repository', dependent: 'run-node-tests' },
      { prerequisite: 'run-node-tests', dependent: 'verify-proof' },
    ],
    currentPlan: { id: 'plan-1', version: 1, steps: ['inspect-repository', 'run-node-tests', 'verify-proof'] },
    constraints: ['completion requires independently verified proof'],
    permissions: [
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'rune', actions: ['execute_node_tests'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
      { actor: 'qra_recovery_driver', actions: [...RECOVERY_ACTIONS] },
    ],
    environmentObservations: [
      { source: 'titan', key: 'repository_root', value: '/tmp/repo', observedAt: clock() },
    ],
    ...overrides,
  };
}

test('Item 21: mission service learning path rejects direct permanent writes and demonstrates gated improvement', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-learn-'));
  const learning = createGatedLearningPipeline({ now: clock });
  const service = createMissionStateService({ root, clock, learning });
  const created = await service.create(createInput());

  await assert.rejects(
    () => service.storeLearningPermanent({
      experienceId: 'exp-forge',
      lesson: { id: 'x', statement: 'direct write', expectedBenefit: 'none' },
    }),
    /direct permanent|not approved|cannot/,
  );

  await assert.rejects(
    () => service.transition({
      operationId: 'op-learn-forge',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx' },
      update: {
        learnedKnowledge: [{ id: 'forged' }],
        activeAgents: ['nyx'],
      },
      envelope: undefined,
    }),
    /envelope|learnedKnowledge|unsupported/,
  );

  const measured = await service.runLearningPipeline({
    experience: {
      id: 'exp-svc-1',
      missionId: created.mission.id,
      actor: 'nyx',
      summary: 'retry inspect recovered the path',
      outcome: 'success',
    },
    lesson: {
      id: 'lesson-svc-1',
      statement: 'retry inspect once on transient failure',
      expectedBenefit: 'fewer failed handoffs',
    },
    verification: {
      verified: true,
      layers: { action: true, artifact: true, state: true, subgoal: true, workflow: true, mission: true },
    },
    testResult: { passed: true, metrics: { taskSuccess: true, failedHandoffs: 0 } },
    control: { taskSuccessRate: 0.5, failedHandoffs: 3 },
    candidateMetrics: { taskSuccessRate: 0.85, failedHandoffs: 0 },
    approver: 'qra_emerge_audit',
  });

  assert.equal(measured.improved, true);
  assert.equal(measured.regression, false);
  assert.ok(measured.demonstration.length > 0);
  assert.equal(service.listPermanentLearning().length, 1);
  assert.equal(created.revision, (await service.get({ missionId: created.mission.id })).revision);
});

test('Item 21: executor cannot approve learning into permanent knowledge', async () => {
  const learning = createGatedLearningPipeline({ now: clock });
  await learning.submitExperience({
    id: 'exp-exec-1',
    missionId: 'mission-exec-learn',
    actor: 'nyx',
    summary: 'did work',
    outcome: 'success',
  });
  const candidate = await learning.extractCandidateLesson({
    experienceId: 'exp-exec-1',
    lesson: {
      id: 'lesson-exec-1',
      statement: 'do the thing',
      expectedBenefit: 'speed',
    },
  });
  await learning.verify({
    candidateId: candidate.id,
    verification: {
      verified: true,
      layers: { action: true, artifact: true, state: true, subgoal: true, workflow: true, mission: true },
    },
  });
  await learning.testCandidate({
    candidateId: candidate.id,
    testResult: { passed: true, metrics: { taskSuccess: true, failedHandoffs: 0 } },
  });
  await learning.compareAgainstControl({
    candidateId: candidate.id,
    control: { taskSuccessRate: 0.5, failedHandoffs: 2 },
    candidate: { taskSuccessRate: 0.7, failedHandoffs: 1 },
  });
  await assert.rejects(
    () => learning.approve({ candidateId: candidate.id, actor: 'nyx' }),
    /cannot approve|unauthorized/,
  );
});
