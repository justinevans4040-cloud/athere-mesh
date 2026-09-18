import {
  isBrandedValidatedSkillLibrary,
} from './validated-skill-library.js';

const BRANDED_PROGRESSIVE_DISCLOSURES = new WeakSet();

export function isBrandedProgressiveSkillDisclosure(value) {
  return value != null && typeof value === 'object' && BRANDED_PROGRESSIVE_DISCLOSURES.has(value);
}

function freezeArray(value) {
  return Object.freeze(Array.isArray(value) ? [...value] : []);
}

function compactProvenance(provenance) {
  const source = provenance && typeof provenance === 'object' ? provenance : {};
  const compact = {};
  for (const key of [
    'source',
    'lessonId',
    'experienceId',
    'approvedBy',
    'publishedAt',
    'supersedesVersion',
  ]) {
    if (source[key] !== undefined) compact[key] = source[key];
  }
  return Object.freeze(compact);
}

function descriptorFor(skillId, version, skill) {
  return Object.freeze({
    skillId,
    version,
    purpose: skill.purpose,
    inputs: freezeArray(skill.inputs),
    outputs: freezeArray(skill.outputs),
    prerequisites: freezeArray(skill.prerequisites),
    verificationMethod: skill.verificationMethod,
    provenance: compactProvenance(skill.provenance),
  });
}

export function createProgressiveSkillDisclosure({ library } = {}) {
  if (!isBrandedValidatedSkillLibrary(library)) {
    throw new TypeError('library must be a branded validated skill library');
  }

  const disclosure = Object.freeze({
    list() {
      const descriptors = library.list().map(({ skillId, version, skill }) => (
        descriptorFor(skillId, version, skill)
      ));
      return Object.freeze(descriptors);
    },

    async load({ skillId, version } = {}) {
      const reused = await library.reuse({ skillId, version });
      return Object.freeze({ ...reused });
    },
  });
  BRANDED_PROGRESSIVE_DISCLOSURES.add(disclosure);
  return disclosure;
}
