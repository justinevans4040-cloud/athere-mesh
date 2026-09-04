/**
 * Item 21 — gated Experience → Learning pipeline.
 * Permanent knowledge only after EXPERIENCE→…→APPROVE→STORE with QR18-style gates.
 */

import {
  assertCannotWritePermanentDirectly,
  assertLearningApprover,
  assertLearningStageOrder,
  compareLearningMetrics,
  evaluateLearningQr18,
  normalizeCandidateLesson,
  normalizeExperience,
} from '../../contracts/src/learning-pipeline.js';

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function createGatedLearningPipeline({ now = () => new Date().toISOString() } = {}) {
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  const experiences = new Map();
  const candidates = new Map();
  const permanent = new Map();

  function getCandidate(candidateId) {
    const id = requiredText(candidateId, 'candidateId');
    const entry = candidates.get(id);
    if (!entry) throw new Error(`unknown learning candidate: ${id}`);
    return entry;
  }

  function advance(entry, expectedStage, nextStage, patch) {
    if (entry.stage !== expectedStage) {
      throw new Error(`learning candidate stage mismatch: expected ${expectedStage}, got ${entry.stage}`);
    }
    assertLearningStageOrder(expectedStage, nextStage);
    const updated = Object.freeze({ ...entry, ...patch, stage: nextStage, updatedAt: now() });
    candidates.set(entry.id, updated);
    return updated;
  }

  return Object.freeze({
    async submitExperience(input) {
      const experience = normalizeExperience({ ...input, recordedAt: input.recordedAt ?? now() });
      if (experiences.has(experience.id)) throw new Error(`duplicate experience id: ${experience.id}`);
      const record = Object.freeze({ ...experience, stage: 'experience' });
      experiences.set(experience.id, record);
      return record;
    },

    async extractCandidateLesson({ experienceId, lesson }) {
      const experience = experiences.get(experienceId);
      if (!experience) throw new Error(`unknown experience: ${experienceId}`);
      const normalized = normalizeCandidateLesson({
        ...lesson,
        experienceId,
      });
      if (candidates.has(normalized.id)) throw new Error(`duplicate lesson id: ${normalized.id}`);
      assertLearningStageOrder('experience', 'extract_candidate_lesson');
      const record = Object.freeze({
        ...normalized,
        stage: 'extract_candidate_lesson',
        experience,
        verification: null,
        testResult: null,
        comparison: null,
        approvedBy: null,
        createdAt: now(),
        updatedAt: now(),
      });
      candidates.set(normalized.id, record);
      return record;
    },

    async verify({ candidateId, verification }) {
      const entry = getCandidate(candidateId);
      if (verification?.verified !== true) {
        throw new Error('learning verification failed');
      }
      return advance(entry, 'extract_candidate_lesson', 'verify', { verification: Object.freeze({ ...verification }) });
    },

    async testCandidate({ candidateId, testResult }) {
      const entry = getCandidate(candidateId);
      if (testResult?.passed !== true) throw new Error('learning test failed');
      return advance(entry, 'verify', 'test', { testResult: Object.freeze({ ...testResult }) });
    },

    async compareAgainstControl({ candidateId, control, candidate }) {
      const entry = getCandidate(candidateId);
      const comparison = compareLearningMetrics({ control, candidate });
      if (comparison.regression || !comparison.improved) {
        throw new Error('learning candidate regression or not improved vs control');
      }
      return advance(entry, 'test', 'compare_against_control', { comparison });
    },

    async approve({ candidateId, actor }) {
      const entry = getCandidate(candidateId);
      const approver = assertLearningApprover(actor);
      const qr18 = evaluateLearningQr18({
        experience: entry.experience,
        lesson: entry,
        verification: entry.verification,
        testResult: entry.testResult,
        comparison: entry.comparison,
      });
      if (!qr18.verified) {
        throw new Error(`learning QR18-style gate failed: ${qr18.reasons.join('; ')}`);
      }
      return advance(entry, 'compare_against_control', 'approve', { approvedBy: approver, qr18 });
    },

    async store({ candidateId }) {
      const entry = getCandidate(candidateId);
      if (entry.stage !== 'approve') {
        throw new Error('learning store requires approved candidate');
      }
      assertLearningStageOrder('approve', 'store');
      const stored = Object.freeze({
        ...entry,
        stage: 'store',
        storedAt: now(),
        updatedAt: now(),
      });
      candidates.set(entry.id, stored);
      permanent.set(entry.id, stored);
      return stored;
    },

    async storePermanent(payload) {
      assertCannotWritePermanentDirectly(payload);
    },

    async reuse({ lessonId }) {
      const id = requiredText(lessonId, 'lessonId');
      const stored = permanent.get(id);
      if (!stored) throw new Error(`unknown permanent lesson: ${id}`);
      assertLearningStageOrder('store', 'reuse');
      const reused = Object.freeze({
        ...stored,
        stage: 'reuse',
        reuseCount: (stored.reuseCount ?? 0) + 1,
        updatedAt: now(),
      });
      permanent.set(id, reused);
      candidates.set(id, reused);
      return reused;
    },

    async measure({ lessonId }) {
      const id = requiredText(lessonId, 'lessonId');
      const stored = permanent.get(id);
      if (!stored) throw new Error(`unknown permanent lesson: ${id}`);
      if (stored.stage !== 'reuse' && stored.stage !== 'measure') {
        throw new Error('measure requires reused lesson');
      }
      if (stored.stage === 'reuse') assertLearningStageOrder('reuse', 'measure');
      const comparison = stored.comparison;
      const measured = Object.freeze({
        lessonId: id,
        improved: comparison?.improved === true,
        regression: comparison?.regression === true,
        control: comparison?.control ?? null,
        candidate: comparison?.candidate ?? null,
        demonstration: comparison?.improved === true && comparison?.regression !== true
          ? `retained learning ${id} improved taskSuccessRate ${comparison.control.taskSuccessRate} -> ${comparison.candidate.taskSuccessRate} without increasing failedHandoffs`
          : `retained learning ${id} did not demonstrate safe improvement`,
        stage: 'measure',
      });
      const next = Object.freeze({ ...stored, stage: 'measure', measurement: measured, updatedAt: now() });
      permanent.set(id, next);
      candidates.set(id, next);
      return measured;
    },

    listPermanent() {
      return Object.freeze([...permanent.values()]);
    },

    async runPipeline({
      experience,
      lesson,
      verification,
      testResult,
      control,
      candidateMetrics,
      approver,
    }) {
      const submitted = await this.submitExperience(experience);
      const candidate = await this.extractCandidateLesson({
        experienceId: submitted.id,
        lesson,
      });
      await this.verify({ candidateId: candidate.id, verification });
      await this.testCandidate({ candidateId: candidate.id, testResult });
      await this.compareAgainstControl({
        candidateId: candidate.id,
        control,
        candidate: candidateMetrics,
      });
      await this.approve({ candidateId: candidate.id, actor: approver });
      const stored = await this.store({ candidateId: candidate.id });
      await this.reuse({ lessonId: stored.id });
      return this.measure({ lessonId: stored.id });
    },
  });
}
