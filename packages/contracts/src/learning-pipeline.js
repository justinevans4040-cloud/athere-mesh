/**
 * Item 21 — gated Experience → Learning pipeline contracts.
 * Agents cannot write experiences directly into permanent knowledge.
 */

export const LEARNING_STAGES = Object.freeze([
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

const STAGE_INDEX = Object.freeze(Object.fromEntries(LEARNING_STAGES.map((stage, index) => [stage, index])));

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const APPROVERS = Object.freeze(new Set(['qra_emerge_audit', 'miss-vale-prime']));

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

function rate(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${label} must be a finite number in 0..1`);
  }
  return value;
}

function nonNegInt(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value;
}

export function assertLearningStageOrder(fromStage, toStage) {
  const from = requiredText(fromStage, 'fromStage');
  const to = requiredText(toStage, 'toStage');
  if (!(from in STAGE_INDEX) || !(to in STAGE_INDEX)) {
    throw new Error(`unknown learning stage: ${from} -> ${to}`);
  }
  if (STAGE_INDEX[to] !== STAGE_INDEX[from] + 1) {
    throw new Error(`cannot skip learning stages: ${from} -> ${to}`);
  }
  return true;
}

export function assertCannotWritePermanentDirectly(payload) {
  plainObject(payload ?? {}, 'payload');
  throw new Error('direct permanent learning writes are forbidden; use the gated pipeline');
}

export function normalizeExperience(input = {}) {
  const object = plainObject(input, 'experience');
  return Object.freeze({
    id: requiredId(object.id, 'experience id'),
    missionId: requiredId(object.missionId, 'missionId'),
    actor: requiredId(object.actor, 'actor'),
    summary: requiredText(object.summary, 'summary'),
    outcome: requiredText(object.outcome, 'outcome'),
    recordedAt: object.recordedAt ?? null,
  });
}

export function normalizeCandidateLesson(input = {}) {
  const object = plainObject(input, 'lesson');
  return Object.freeze({
    id: requiredId(object.id, 'lesson id'),
    experienceId: requiredId(object.experienceId, 'experienceId'),
    statement: requiredText(object.statement, 'statement'),
    expectedBenefit: requiredText(object.expectedBenefit, 'expectedBenefit'),
  });
}

export function normalizeMetrics(input = {}, label = 'metrics') {
  const object = plainObject(input, label);
  return Object.freeze({
    taskSuccessRate: rate(object.taskSuccessRate, `${label}.taskSuccessRate`),
    failedHandoffs: nonNegInt(object.failedHandoffs, `${label}.failedHandoffs`),
  });
}

export function compareLearningMetrics({ control, candidate } = {}) {
  const baseline = normalizeMetrics(control, 'control');
  const trial = normalizeMetrics(candidate, 'candidate');
  const improved = trial.taskSuccessRate > baseline.taskSuccessRate
    && trial.failedHandoffs <= baseline.failedHandoffs;
  const regression = trial.taskSuccessRate < baseline.taskSuccessRate
    || trial.failedHandoffs > baseline.failedHandoffs;
  return Object.freeze({
    improved,
    regression,
    control: baseline,
    candidate: trial,
  });
}

export function evaluateLearningQr18({
  experience,
  lesson,
  verification,
  testResult,
  comparison,
} = {}) {
  const layers = plainObject(verification?.layers ?? {}, 'verification.layers');
  const required = ['action', 'artifact', 'state', 'subgoal', 'workflow', 'mission'];
  const layerOk = required.every((key) => layers[key] === true);
  const verified = Boolean(experience?.id)
    && Boolean(lesson?.id)
    && verification?.verified === true
    && layerOk
    && testResult?.passed === true
    && comparison?.improved === true
    && comparison?.regression === false;
  return Object.freeze({
    verified,
    layers: Object.freeze({ ...layers }),
    reasons: Object.freeze(verified ? [] : [
      ...(verification?.verified === true ? [] : ['verification incomplete']),
      ...(layerOk ? [] : ['qr18-style layers incomplete']),
      ...(testResult?.passed === true ? [] : ['test failed']),
      ...(comparison?.improved === true ? [] : ['no improvement vs control']),
      ...(comparison?.regression === false ? [] : ['regression vs control']),
    ]),
  });
}

export function assertLearningApprover(actor) {
  const id = requiredId(actor, 'approver');
  if (!APPROVERS.has(id)) {
    throw new Error(`unauthorized learning approver: ${id}; executor cannot approve`);
  }
  return id;
}

export function nextLearningStage(stage) {
  const current = requiredText(stage, 'stage');
  const index = STAGE_INDEX[current];
  if (index === undefined) throw new Error(`unknown learning stage: ${current}`);
  if (index >= LEARNING_STAGES.length - 1) return current;
  return LEARNING_STAGES[index + 1];
}
