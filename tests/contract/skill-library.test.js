import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SKILL_REQUIRED_FIELDS,
  normalizeSkill,
  assertSkillImmutable,
} from '../../packages/contracts/src/skill-library.js';
import { createGatedLearningPipeline } from '../../packages/learning/src/gated-learning-pipeline.js';
import { createAgentIdentityRegistry } from '../../packages/identity/src/agent-identity-registry.js';
import { createValidatedSkillLibrary } from '../../packages/skills/src/validated-skill-library.js';

test('Item 22 contract: skill requires backlog fields and rejects incomplete records', () => {
  for (const field of [
    'purpose', 'inputs', 'outputs', 'prerequisites', 'procedure',
    'verificationMethod', 'historicalSuccessRate', 'failureRate',
    'compatibleModels', 'cost', 'version', 'provenance',
  ]) {
    assert.ok(SKILL_REQUIRED_FIELDS.includes(field), field);
  }

  const skill = normalizeSkill({
    id: 'skill-retry-inspect',
    purpose: 'Recover transient inspect failures',
    inputs: ['missionId', 'repositoryRoot'],
    outputs: ['inspectionEvidence'],
    prerequisites: ['repository accessible'],
    procedure: ['inspect', 'on failure retry once', 'record evidence'],
    verificationMethod: 'evidence present and path valid',
    historicalSuccessRate: 0.8,
    failureRate: 0.2,
    compatibleModels: ['ollama:llama3.2:3b', 'local'],
    cost: { max_tool_calls: 2, max_state_mutations: 1 },
    version: 1,
    provenance: { lessonId: 'lesson-1', source: 'gated_learning' },
  });
  assert.equal(skill.id, 'skill-retry-inspect');
  assert.equal(skill.version, 1);
  assert.throws(
    () => normalizeSkill({ id: 'x', purpose: 'y' }),
    /required|missing|must/,
  );
  assert.throws(
    () => normalizeSkill({
      id: 'skill-bad-rates',
      purpose: 'Recover transient inspect failures',
      inputs: ['missionId', 'repositoryRoot'],
      outputs: ['inspectionEvidence'],
      prerequisites: ['repository accessible'],
      procedure: ['inspect', 'on failure retry once', 'record evidence'],
      verificationMethod: 'evidence present and path valid',
      historicalSuccessRate: 0.8,
      failureRate: 0.3,
      compatibleModels: ['ollama:llama3.2:3b', 'local'],
      cost: { max_tool_calls: 2, max_state_mutations: 1 },
      version: 1,
      provenance: { lessonId: 'lesson-1', source: 'gated_learning' },
    }),
    /cannot exceed 1/,
  );
  assert.throws(
    () => assertSkillImmutable(skill, { ...skill, procedure: ['mutated'] }),
    /silent mutation|immutable/,
  );
});

test('Item 22 contract: library versions skills and reuses validated experience', async () => {
  const learning = createGatedLearningPipeline({ now: () => '2026-09-05T00:00:00.000Z', identities: createAgentIdentityRegistry() });
  const measured = await learning.runPipeline({
    experience: {
      id: 'exp-skill-1',
      missionId: 'mission-skill-1',
      actor: 'nyx',
      summary: 'retry inspect worked',
      outcome: 'success',
    },
    lesson: {
      id: 'lesson-skill-1',
      statement: 'retry inspect once on transient failure',
      expectedBenefit: 'fewer failed handoffs',
    },
    verification: {
      verified: true,
      layers: { action: true, artifact: true, state: true, subgoal: true, workflow: true, mission: true },
    },
    testResult: { passed: true, metrics: { taskSuccess: true, failedHandoffs: 0 } },
    approver: 'qra_emerge_audit',
  });
  assert.equal(measured.improved, true);

  const library = createValidatedSkillLibrary({ learning, now: () => '2026-09-05T00:00:00.000Z' });
  const published = await library.publishFromLesson({
    lessonId: 'lesson-skill-1',
    skill: {
      id: 'skill-retry-inspect',
      purpose: 'Recover transient inspect failures',
      inputs: ['missionId'],
      outputs: ['evidence'],
      prerequisites: ['repo available'],
      procedure: ['inspect', 'retry once', 'record evidence'],
      verificationMethod: 'evidence recorded',
      historicalSuccessRate: 0.8,
      failureRate: 0.2,
      compatibleModels: ['local'],
      cost: { max_tool_calls: 2, max_state_mutations: 1 },
    },
  });
  assert.equal(published.version, 1);
  assert.equal(published.provenance.lessonId, 'lesson-skill-1');

  const reused = await library.reuse({ skillId: 'skill-retry-inspect' });
  assert.deepEqual(reused.procedure, ['inspect', 'retry once', 'record evidence']);
  assert.equal(reused.derivedFromScratch, false);
  assert.equal(reused.version, 1);

  await assert.rejects(
    () => library.mutateInPlace({
      skillId: 'skill-retry-inspect',
      patch: { procedure: ['silent change'] },
    }),
    /silent mutation|immutable|version/,
  );

  await assert.rejects(
    () => library.publishVersion({
      skillId: 'skill-retry-inspect',
      lessonId: 'lesson-skill-1',
      skill: {
        purpose: 'Recover transient inspect failures',
        inputs: ['missionId'],
        outputs: ['evidence'],
        prerequisites: ['repo available'],
        procedure: ['inspect', 'retry once', 'escalate if second fail'],
        verificationMethod: 'evidence recorded',
        historicalSuccessRate: 0.85,
        failureRate: 0.15,
        compatibleModels: ['local'],
        cost: { max_tool_calls: 3, max_state_mutations: 1 },
      },
    }),
    /new validated permanent lesson/,
  );

  await learning.runPipeline({
    experience: {
      id: 'exp-skill-2',
      missionId: 'mission-skill-1',
      actor: 'nyx',
      summary: 'retry then escalate worked',
      outcome: 'success',
    },
    lesson: {
      id: 'lesson-skill-2',
      statement: 'retry once then escalate',
      expectedBenefit: 'contain failures',
    },
    verification: {
      verified: true,
      layers: { action: true, artifact: true, state: true, subgoal: true, workflow: true, mission: true },
    },
    testResult: { passed: true, metrics: { taskSuccess: true, failedHandoffs: 0 } },
    approver: 'qra_emerge_audit',
  });

  const v2 = await library.publishVersion({
    skillId: 'skill-retry-inspect',
    lessonId: 'lesson-skill-2',
    skill: {
      purpose: 'Recover transient inspect failures',
      inputs: ['missionId'],
      outputs: ['evidence'],
      prerequisites: ['repo available'],
      procedure: ['inspect', 'retry once', 'escalate if second fail'],
      verificationMethod: 'evidence recorded',
      historicalSuccessRate: 0.85,
      failureRate: 0.15,
      compatibleModels: ['local'],
      cost: { max_tool_calls: 3, max_state_mutations: 1 },
    },
  });
  assert.equal(v2.version, 2);
  assert.equal(v2.provenance.lessonId, 'lesson-skill-2');
  const current = await library.get({ skillId: 'skill-retry-inspect' });
  assert.equal(current.version, 2);
  const prior = await library.get({ skillId: 'skill-retry-inspect', version: 1 });
  assert.deepEqual(prior.procedure, ['inspect', 'retry once', 'record evidence']);
});
