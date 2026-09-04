import test from 'node:test';
import assert from 'node:assert/strict';
import { createGatedLearningPipeline } from '../../packages/learning/src/gated-learning-pipeline.js';
import { createAgentIdentityRegistry } from '../../packages/identity/src/agent-identity-registry.js';
import { createValidatedSkillLibrary } from '../../packages/skills/src/validated-skill-library.js';

function clock() {
  return '2026-09-05T04:00:00.000Z';
}

async function seedLesson(learning, { experienceId, lessonId }) {
  await learning.runPipeline({
    experience: {
      id: experienceId,
      missionId: 'mission-skill-sec',
      actor: 'nyx',
      summary: 'validated path',
      outcome: 'success',
    },
    lesson: {
      id: lessonId,
      statement: `lesson ${lessonId}`,
      expectedBenefit: 'safer reuse',
    },
    verification: {
      verified: true,
      layers: { action: true, artifact: true, state: true, subgoal: true, workflow: true, mission: true },
    },
    testResult: { passed: true, metrics: { taskSuccess: true, failedHandoffs: 0 } },
    approver: 'qra_emerge_audit',
  });
}

test('Item 22 security: unvalidated version and impossible rates fail closed', async () => {
  const learning = createGatedLearningPipeline({ now: clock, identities: createAgentIdentityRegistry() });
  await seedLesson(learning, { experienceId: 'exp-sec-1', lessonId: 'lesson-sec-1' });
  const library = createValidatedSkillLibrary({ learning, now: clock });

  await assert.rejects(
    () => library.publishFromLesson({
      lessonId: 'lesson-sec-1',
      skill: {
        id: 'skill-sec',
        purpose: 'p',
        inputs: ['a'],
        outputs: ['b'],
        prerequisites: ['c'],
        procedure: ['safe'],
        verificationMethod: 'e',
        historicalSuccessRate: 0.9,
        failureRate: 0.2,
        compatibleModels: ['local'],
        cost: { max_tool_calls: 1, max_state_mutations: 1 },
      },
    }),
    /cannot exceed 1/,
  );

  const published = await library.publishFromLesson({
    lessonId: 'lesson-sec-1',
    skill: {
      id: 'skill-sec',
      purpose: 'p',
      inputs: ['a'],
      outputs: ['b'],
      prerequisites: ['c'],
      procedure: ['safe'],
      verificationMethod: 'e',
      historicalSuccessRate: 0.8,
      failureRate: 0.2,
      compatibleModels: ['local'],
      cost: { max_tool_calls: 1, max_state_mutations: 1 },
    },
  });
  assert.equal(published.version, 1);

  await assert.rejects(
    () => library.publishVersion({
      skillId: 'skill-sec',
      skill: {
        purpose: 'p',
        inputs: ['a'],
        outputs: ['b'],
        prerequisites: ['c'],
        procedure: ['shell_rm_rf'],
        verificationMethod: 'none',
        historicalSuccessRate: 1,
        failureRate: 0,
        compatibleModels: ['local'],
        cost: { max_tool_calls: 99, max_state_mutations: 99 },
      },
    }),
    /lessonId|new validated permanent lesson|required/,
  );

  await assert.rejects(
    () => library.publishVersion({
      skillId: 'skill-sec',
      lessonId: 'lesson-sec-1',
      skill: {
        purpose: 'p',
        inputs: ['a'],
        outputs: ['b'],
        prerequisites: ['c'],
        procedure: ['shell_rm_rf'],
        verificationMethod: 'none',
        historicalSuccessRate: 1,
        failureRate: 0,
        compatibleModels: ['local'],
        cost: { max_tool_calls: 99, max_state_mutations: 99 },
      },
    }),
    /new validated permanent lesson/,
  );

  const after = await library.get({ skillId: 'skill-sec' });
  assert.equal(after.version, 1);
  assert.deepEqual(after.procedure, ['safe']);
});
