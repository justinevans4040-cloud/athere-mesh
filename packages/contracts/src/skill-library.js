/**
 * Item 22 — validated skill library contracts.
 * Skills evolve by versioning; never silent mutation.
 */

export const SKILL_REQUIRED_FIELDS = Object.freeze([
  'purpose',
  'inputs',
  'outputs',
  'prerequisites',
  'procedure',
  'verificationMethod',
  'historicalSuccessRate',
  'failureRate',
  'compatibleModels',
  'cost',
  'version',
  'provenance',
]);

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requiredId(value, label) {
  const id = requiredText(value, label);
  if (!SAFE_ID.test(id)) throw new Error(`invalid ${label}`);
  return id;
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function stringList(value, label, { min = 1, max = 32 } = {}) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  if (value.length < min || value.length > max) {
    throw new Error(`${label} length must be ${min}..${max}`);
  }
  return Object.freeze(value.map((entry, index) => requiredText(entry, `${label}[${index}]`)));
}

function rate(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${label} must be a finite number in 0..1`);
  }
  return value;
}

function costObject(value) {
  const cost = plainObject(value ?? {}, 'cost');
  const max_tool_calls = Number.isSafeInteger(cost.max_tool_calls) && cost.max_tool_calls >= 0
    ? cost.max_tool_calls
    : null;
  const max_state_mutations = Number.isSafeInteger(cost.max_state_mutations) && cost.max_state_mutations >= 0
    ? cost.max_state_mutations
    : null;
  if (max_tool_calls === null || max_state_mutations === null) {
    throw new TypeError('cost requires max_tool_calls and max_state_mutations');
  }
  return Object.freeze({ max_tool_calls, max_state_mutations });
}

export function normalizeSkill(input = {}) {
  const object = plainObject(input, 'skill');
  for (const field of SKILL_REQUIRED_FIELDS) {
    if (field === 'id') continue;
    if (!Object.hasOwn(object, field) && field !== 'id') {
      // id is separate; version/provenance required
      if (object[field] === undefined) throw new Error(`skill missing required field: ${field}`);
    }
  }
  if (!Number.isSafeInteger(object.version) || object.version < 1) {
    throw new TypeError('skill version must be a positive integer');
  }
  const historicalSuccessRate = rate(object.historicalSuccessRate, 'historicalSuccessRate');
  const failureRate = rate(object.failureRate, 'failureRate');
  if (historicalSuccessRate + failureRate > 1 + Number.EPSILON) {
    throw new Error('historicalSuccessRate + failureRate cannot exceed 1');
  }
  const provenance = plainObject(object.provenance, 'provenance');
  if (typeof provenance.source !== 'string' || provenance.source.trim().length === 0) {
    throw new TypeError('provenance.source is required');
  }
  return Object.freeze({
    id: requiredId(object.id, 'skill id'),
    purpose: requiredText(object.purpose, 'purpose'),
    inputs: stringList(object.inputs, 'inputs'),
    outputs: stringList(object.outputs, 'outputs'),
    prerequisites: stringList(object.prerequisites, 'prerequisites'),
    procedure: stringList(object.procedure, 'procedure'),
    verificationMethod: requiredText(object.verificationMethod, 'verificationMethod'),
    historicalSuccessRate,
    failureRate,
    compatibleModels: stringList(object.compatibleModels, 'compatibleModels'),
    cost: costObject(object.cost),
    version: object.version,
    provenance: Object.freeze({ ...provenance }),
  });
}

export function assertSkillImmutable(existing, next) {
  const current = plainObject(existing, 'existing skill');
  const candidate = plainObject(next, 'next skill');
  if (current.id !== candidate.id) throw new Error('skill id mismatch');
  if (current.version !== candidate.version) return true;
  const keys = [
    'purpose', 'inputs', 'outputs', 'prerequisites', 'procedure',
    'verificationMethod', 'historicalSuccessRate', 'failureRate',
    'compatibleModels', 'cost', 'provenance',
  ];
  for (const key of keys) {
    if (JSON.stringify(current[key]) !== JSON.stringify(candidate[key])) {
      throw new Error('silent mutation forbidden; publish a new skill version');
    }
  }
  return true;
}
