import test from 'node:test';
import assert from 'node:assert/strict';

import { createAgentIdentityRegistry } from '../../packages/identity/src/agent-identity-registry.js';
import { createGatedLearningPipeline } from '../../packages/learning/src/gated-learning-pipeline.js';
import { createProgressiveSkillDisclosure } from '../../packages/skills/src/progressive-skill-disclosure.js';
import { createValidatedSkillLibrary } from '../../packages/skills/src/validated-skill-library.js';

async function createLibraryWithSkill() {
  const learning = createGatedLearningPipeline({
    now: () => '2026-09-16T00:00:00.000Z',
    identities: createAgentIdentityRegistry(),
  });
  await learning.runPipeline({
    experience: {
      id: 'exp-disclosure-1',
      missionId: 'mission-disclosure-1',
      actor: 'nyx',
      summary: 'repository review procedure succeeded',
      outcome: 'success',
    },
    lesson: {
      id: 'lesson-disclosure-1',
      statement: 'review repository using bounded evidence steps',
      expectedBenefit: 'repeatable repository review',
    },
    verification: {
      verified: true,
      layers: { action: true, artifact: true, state: true, subgoal: true, workflow: true, mission: true },
    },
    testResult: { passed: true, metrics: { taskSuccess: true, failedHandoffs: 0 } },
    approver: 'qra_emerge_audit',
  });

  const library = createValidatedSkillLibrary({
    learning,
    now: () => '2026-09-16T00:00:00.000Z',
  });
  await library.publishFromLesson({
    lessonId: 'lesson-disclosure-1',
    skill: {
      id: 'repo-review',
      purpose: 'Review a repository with evidence',
      inputs: ['repositoryRoot'],
      outputs: ['reviewEvidence'],
      prerequisites: ['repository accessible'],
      procedure: ['inspect', 'review', 'verify evidence'],
      verificationMethod: 'evidence references current repository state',
      historicalSuccessRate: 0.9,
      failureRate: 0.1,
      compatibleModels: ['local'],
      cost: { max_tool_calls: 4, max_state_mutations: 0 },
    },
  });
  return library;
}

test('list exposes compact validated descriptors without procedures', async () => {
  const library = await createLibraryWithSkill();
  const disclosure = createProgressiveSkillDisclosure({ library });
  const descriptors = disclosure.list();
  assert.equal(descriptors.length, 1);
  const descriptor = descriptors[0];
  assert.equal(descriptor.skillId, 'repo-review');
  assert.equal(descriptor.version, 1);
  assert.equal(descriptor.purpose, 'Review a repository with evidence');
  assert.deepEqual(descriptor.prerequisites, ['repository accessible']);
  assert.equal(descriptor.verificationMethod, 'evidence references current repository state');
  assert.equal(descriptor.provenance.source, 'gated_learning');
  assert.equal('procedure' in descriptor, false);
  assert.ok(Object.isFrozen(descriptor));
  assert.ok(Object.isFrozen(descriptors));
});

test('load delegates to canonical validated library and preserves exact version provenance', async () => {
  const library = await createLibraryWithSkill();
  const disclosure = createProgressiveSkillDisclosure({ library });
  const loaded = await disclosure.load({ skillId: 'repo-review', version: 1 });
  assert.equal(loaded.skillId, 'repo-review');
  assert.equal(loaded.version, 1);
  assert.deepEqual(loaded.procedure, ['inspect', 'review', 'verify evidence']);
  assert.equal(loaded.derivedFromScratch, false);
  assert.equal(loaded.provenance.lessonId, 'lesson-disclosure-1');
  assert.ok(Object.isFrozen(loaded));
});

test('disclosure rejects unbranded lookalike libraries', () => {
  assert.throws(
    () => createProgressiveSkillDisclosure({
      library: { list: () => [], reuse: async () => ({}) },
    }),
    /validated skill library|branded/i,
  );
});
