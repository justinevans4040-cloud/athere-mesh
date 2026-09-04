import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEARNING_STAGES,
  assertLearningStageOrder,
  normalizeExperience,
  normalizeCandidateLesson,
  evaluateLearningQr18,
  assertCannotWritePermanentDirectly,
} from '../../packages/contracts/src/learning-pipeline.js';
import { createGatedLearningPipeline } from '../../packages/learning/src/gated-learning-pipeline.js';
import { createAgentIdentityRegistry } from '../../packages/identity/src/agent-identity-registry.js';
import {
  ATHERE_REPO_ROOT,
  loadItem21HarnessCandidate,
} from '../support/learning-harness-control.js';
import { buildEfficiencyCandidateCohort } from '../../packages/evaluation/src/evaluation-harness.js';

test('Item 21 contract: gated stages are ordered and cannot be skipped', () => {
  assert.deepEqual([...LEARNING_STAGES], [
    'experience',
    'extract_candidate_lesson',
    'verify',
    'test',
    'compare_against_control',
    'approve',
    'store',
    'reuse',
    'measure',
  ]);
  assert.equal(assertLearningStageOrder('experience', 'extract_candidate_lesson'), true);
  assert.throws(
    () => assertLearningStageOrder('experience', 'store'),
    /cannot skip/,
  );
  assert.throws(
    () => assertCannotWritePermanentDirectly({ experienceId: 'exp-1' }),
    /direct permanent/,
  );
});

test('Item 21 contract: QR18-style learning verification fails closed when incomplete', () => {
  const experience = normalizeExperience({
    id: 'exp-1',
    missionId: 'mission-1',
    actor: 'nyx',
    summary: 'inspect succeeded after retry',
    outcome: 'success',
  });
  const lesson = normalizeCandidateLesson({
    id: 'lesson-1',
    experienceId: experience.id,
    statement: 'retry inspect once on transient failure',
    expectedBenefit: 'fewer failed handoffs',
  });
  assert.equal(experience.id, 'exp-1');
  assert.equal(lesson.experienceId, 'exp-1');

  const incomplete = evaluateLearningQr18({
    experience,
    lesson,
    verification: { verified: false },
    testResult: { passed: true },
    comparison: { improved: true, regression: false },
  });
  assert.equal(incomplete.verified, false);

  const complete = evaluateLearningQr18({
    experience,
    lesson,
    verification: { verified: true, layers: { action: true, artifact: true, state: true, subgoal: true, workflow: true, mission: true } },
    testResult: { passed: true, metrics: { taskSuccess: true, failedHandoffs: 0 } },
    comparison: {
      improved: true,
      regression: false,
      harnessVerdict: 'improvement_proven',
      control: { taskSuccessRate: 1, failedHandoffs: 0 },
      candidate: { taskSuccessRate: 1, failedHandoffs: 0 },
    },
  });
  assert.equal(complete.verified, true);
});

test('Item 21 contract: pipeline stores only after approve; regressions cannot be retained', async () => {
  const harness = await loadItem21HarnessCandidate();
  const pipeline = createGatedLearningPipeline({
    identities: createAgentIdentityRegistry(),
    repositoryRoot: ATHERE_REPO_ROOT,
  });
  const experience = await pipeline.submitExperience({
    id: 'exp-pipe-1',
    missionId: 'mission-pipe-1',
    actor: 'nyx',
    summary: 'worked after retry',
    outcome: 'success',
  });
  assert.equal(experience.stage, 'experience');
  assert.equal(pipeline.listPermanent().length, 0);

  await assert.rejects(
    () => pipeline.storePermanent({ experienceId: experience.id, lesson: { statement: 'skip gates' } }),
    /direct permanent|not approved|cannot/,
  );

  const candidate = await pipeline.extractCandidateLesson({
    experienceId: experience.id,
    lesson: {
      id: 'lesson-pipe-1',
      statement: 'retry inspect once',
      expectedBenefit: 'reduce failed handoffs',
    },
  });
  await pipeline.verify({
    candidateId: candidate.id,
    verification: {
      verified: true,
      layers: { action: true, artifact: true, state: true, subgoal: true, workflow: true, mission: true },
    },
  });
  await pipeline.testCandidate({
    candidateId: candidate.id,
    testResult: { passed: true, metrics: { taskSuccess: true, failedHandoffs: 0 } },
  });

  await assert.rejects(
    () => pipeline.compareAgainstControl({
      candidateId: candidate.id,
      control: { taskSuccessRate: 0.9, failedHandoffs: 0 },
      candidate: { taskSuccessRate: 0.4, failedHandoffs: 5 },
    }),
    /caller-supplied|rejected/,
  );

  const regressing = buildEfficiencyCandidateCohort(harness.control, {
    candidateId: 'regress-cand',
    systemVersion: 'regress-local',
    latencyDeltaMs: -200,
  });
  const badTrials = regressing.trials.map((trial) => Object.freeze({
    ...structuredClone(trial),
    taskResults: Object.freeze({
      ...trial.taskResults,
      mission_contract: false,
    }),
  }));
  const badCohort = Object.freeze({
    id: 'regress-cand',
    frozen: false,
    trials: Object.freeze(badTrials),
  });
  await assert.rejects(
    () => pipeline.compareAgainstControl({
      candidateId: candidate.id,
      candidateCohort: badCohort,
    }),
    /regression|not improved/,
  );

  await pipeline.compareAgainstControl({
    candidateId: candidate.id,
    candidateCohort: harness.candidateCohort,
  });
  await pipeline.approve({ candidateId: candidate.id, actor: 'qra_emerge_audit' });
  const stored = await pipeline.store({ candidateId: candidate.id });
  assert.equal(stored.stage, 'store');
  assert.equal(pipeline.listPermanent().length, 1);

  const reused = await pipeline.reuse({ lessonId: stored.id });
  assert.equal(reused.stage, 'reuse');
  const measured = await pipeline.measure({ lessonId: stored.id });
  assert.equal(measured.improved, true);
  assert.equal(measured.regression, false);
  assert.equal(measured.harnessVerdict, 'improvement_proven');
  assert.ok(measured.demonstration.includes('improvement_proven'));
});
