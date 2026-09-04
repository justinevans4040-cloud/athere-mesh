/**
 * Item 22 — validated skill library.
 * Promote gated permanent lessons into versioned reusable skills.
 */

import {
  assertSkillImmutable,
  normalizeSkill,
} from '../../contracts/src/skill-library.js';

/** Hard caps against skill-library DoS. */
export const MAX_SKILLS = 64;
export const MAX_SKILL_VERSIONS = 32;

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function createValidatedSkillLibrary({
  learning,
  now = () => new Date().toISOString(),
} = {}) {
  if (!learning || typeof learning.listPermanent !== 'function') {
    throw new TypeError('learning pipeline with listPermanent is required');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function');

  /** @type {Map<string, Map<number, object>>} */
  const skills = new Map();

  function versionsFor(skillId) {
    const id = requiredText(skillId, 'skillId');
    const map = skills.get(id);
    if (!map || map.size === 0) throw new Error(`unknown skill: ${id}`);
    return map;
  }

  function currentVersion(skillId) {
    const map = versionsFor(skillId);
    return Math.max(...map.keys());
  }

  function findPermanentLesson(lessonId) {
    const id = requiredText(lessonId, 'lessonId');
    const lesson = learning.listPermanent().find((entry) => entry.id === id);
    if (!lesson || (lesson.stage !== 'store' && lesson.stage !== 'reuse' && lesson.stage !== 'measure')) {
      throw new Error(`unknown permanent lesson: ${id}`);
    }
    return lesson;
  }

  return Object.freeze({
    async publishFromLesson({ lessonId, skill }) {
      const lesson = findPermanentLesson(lessonId);
      const id = requiredText(skill?.id, 'skill id');
      if (skills.has(id)) {
        throw new Error(`skill already exists: ${id}; use publishVersion`);
      }
      if (skills.size >= MAX_SKILLS) {
        throw new Error(`skills exceed cap (${MAX_SKILLS})`);
      }
      const normalized = normalizeSkill({
        ...skill,
        id,
        version: 1,
        provenance: {
          source: 'gated_learning',
          lessonId: lesson.id,
          experienceId: lesson.experienceId,
          approvedBy: lesson.approvedBy ?? null,
          publishedAt: now(),
        },
      });
      const versionMap = new Map();
      versionMap.set(1, normalized);
      skills.set(id, versionMap);
      return normalized;
    },

    async publishVersion({ skillId, lessonId, skill }) {
      const id = requiredText(skillId, 'skillId');
      const map = versionsFor(id);
      if (map.size >= MAX_SKILL_VERSIONS) {
        throw new Error(`skill versions exceed cap (${MAX_SKILL_VERSIONS})`);
      }
      const priorVersion = currentVersion(id);
      const prior = map.get(priorVersion);
      const lesson = findPermanentLesson(lessonId);
      if (lesson.id === prior.provenance?.lessonId) {
        throw new Error('skill version requires a new validated permanent lesson');
      }
      const nextVersion = priorVersion + 1;
      const normalized = normalizeSkill({
        ...skill,
        id,
        version: nextVersion,
        provenance: {
          source: 'gated_learning',
          lessonId: lesson.id,
          experienceId: lesson.experienceId,
          approvedBy: lesson.approvedBy ?? null,
          supersedesVersion: priorVersion,
          publishedAt: now(),
        },
      });
      map.set(nextVersion, normalized);
      return normalized;
    },

    async mutateInPlace({ skillId, patch }) {
      const id = requiredText(skillId, 'skillId');
      const version = currentVersion(id);
      const current = versionsFor(id).get(version);
      const attempted = { ...current, ...patch, version };
      assertSkillImmutable(current, attempted);
      throw new Error('silent mutation forbidden; publish a new skill version');
    },

    async get({ skillId, version } = {}) {
      const map = versionsFor(skillId);
      const resolved = version === undefined ? currentVersion(skillId) : version;
      if (!Number.isSafeInteger(resolved) || resolved < 1) {
        throw new TypeError('version must be a positive integer');
      }
      const skill = map.get(resolved);
      if (!skill) throw new Error(`unknown skill version: ${skillId}@${resolved}`);
      return skill;
    },

    async reuse({ skillId, version } = {}) {
      const skill = await this.get({ skillId, version });
      return Object.freeze({
        skillId: skill.id,
        version: skill.version,
        procedure: skill.procedure,
        purpose: skill.purpose,
        inputs: skill.inputs,
        outputs: skill.outputs,
        prerequisites: skill.prerequisites,
        verificationMethod: skill.verificationMethod,
        provenance: skill.provenance,
        derivedFromScratch: false,
      });
    },

    list() {
      return Object.freeze([...skills.keys()].map((skillId) => {
        const version = currentVersion(skillId);
        return Object.freeze({ skillId, version, skill: skills.get(skillId).get(version) });
      }));
    },
  });
}
