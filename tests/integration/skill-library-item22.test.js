import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { createGatedLearningPipeline } from '../../packages/learning/src/gated-learning-pipeline.js';
import { createValidatedSkillLibrary } from '../../packages/skills/src/validated-skill-library.js';

function clock() {
  return '2026-09-05T01:00:00.000Z';
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
    operationId: 'op-skill-create-1',
    id: 'mission-skill-svc-1',
    objective: 'skill library mission',
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

test('Item 22: service reuses validated skill instead of re-deriving from scratch', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-skill-'));
  const learning = createGatedLearningPipeline({ now: clock });
  const skills = createValidatedSkillLibrary({ learning, now: clock });
  const service = createMissionStateService({ root, clock, learning, skills });
  const created = await service.create(createInput());

  await service.runLearningPipeline({
    experience: {
      id: 'exp-svc-skill-1',
      missionId: created.mission.id,
      actor: 'nyx',
      summary: 'retry inspect recovered',
      outcome: 'success',
    },
    lesson: {
      id: 'lesson-svc-skill-1',
      statement: 'retry inspect once',
      expectedBenefit: 'fewer failed handoffs',
    },
    verification: {
      verified: true,
      layers: { action: true, artifact: true, state: true, subgoal: true, workflow: true, mission: true },
    },
    testResult: { passed: true, metrics: { taskSuccess: true, failedHandoffs: 0 } },
    control: { taskSuccessRate: 0.4, failedHandoffs: 3 },
    candidateMetrics: { taskSuccessRate: 0.9, failedHandoffs: 0 },
    approver: 'qra_emerge_audit',
  });

  const published = await service.publishSkillFromLesson({
    lessonId: 'lesson-svc-skill-1',
    skill: {
      id: 'skill-svc-retry',
      purpose: 'Recover inspect',
      inputs: ['missionId'],
      outputs: ['evidence'],
      prerequisites: ['repo'],
      procedure: ['inspect', 'retry once'],
      verificationMethod: 'evidence',
      historicalSuccessRate: 0.9,
      failureRate: 0.1,
      compatibleModels: ['local'],
      cost: { max_tool_calls: 2, max_state_mutations: 1 },
    },
  });
  assert.equal(published.version, 1);

  const reused = await service.reuseSkill({ skillId: 'skill-svc-retry' });
  assert.equal(reused.derivedFromScratch, false);
  assert.deepEqual(reused.procedure, ['inspect', 'retry once']);

  await assert.rejects(
    () => service.transition({
      operationId: 'op-skill-forge',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx' },
      update: { skillLibrary: [{ id: 'forged' }], activeAgents: ['nyx'] },
    }),
    /envelope|skillLibrary|unsupported|learnedKnowledge|skill/,
  );
});

test('Item 22: unpublished or unvalidated lessons cannot enter the skill library', async () => {
  const learning = createGatedLearningPipeline({ now: clock });
  const skills = createValidatedSkillLibrary({ learning, now: clock });
  await assert.rejects(
    () => skills.publishFromLesson({
      lessonId: 'missing-lesson',
      skill: {
        id: 'skill-bad',
        purpose: 'x',
        inputs: ['a'],
        outputs: ['b'],
        prerequisites: ['c'],
        procedure: ['d'],
        verificationMethod: 'e',
        historicalSuccessRate: 0.5,
        failureRate: 0.5,
        compatibleModels: ['local'],
        cost: { max_tool_calls: 1, max_state_mutations: 1 },
      },
    }),
    /unknown permanent lesson|not stored|validated/,
  );
});
