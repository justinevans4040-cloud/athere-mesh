import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const COUNT_METRICS = Object.freeze([
  'failedHandoffs', 'stateDivergence', 'retries', 'recoveryAttempts', 'recoverySuccesses',
  'tokenUse', 'agentCalls', 'toolCalls', 'verifierCalls', 'stateMutations', 'planDeviations', 'memoryErrors',
]);
const MEAN_METRICS = Object.freeze([
  'tokenUse', 'inferenceCostUsd', 'latencyMs', 'agentCalls', 'toolCalls', 'verifierCalls', 'stateMutations',
]);

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative integer`);
}

function nonNegativeNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be a non-negative finite number`);
}

function validateTrial(trial, expectedSuiteId) {
  requiredText(trial?.id, 'trial id');
  const suiteId = requiredText(trial?.suiteId, 'suite id');
  if (expectedSuiteId && suiteId !== expectedSuiteId) throw new Error(`trial suite mismatch: ${suiteId}`);
  requiredText(trial?.systemVersion, 'system version');
  requiredText(trial?.model?.provider, 'model provider');
  requiredText(trial?.model?.name, 'model name');
  requiredText(trial?.model?.version, 'model version');
  requiredText(trial?.environment?.id, 'environment id');
  requiredText(trial?.environment?.version, 'environment version');
  if (typeof trial.environment.deterministic !== 'boolean') throw new TypeError('environment deterministic flag must be boolean');
  if (!Number.isSafeInteger(trial.seed)) throw new TypeError('trial seed must be a safe integer');
  if (typeof trial?.metrics?.taskSuccess !== 'boolean') throw new TypeError('taskSuccess must be boolean');
  if (typeof trial.metrics.falseSuccess !== 'boolean') throw new TypeError('falseSuccess must be boolean');
  if (trial.metrics.falseSuccess && trial.metrics.taskSuccess) throw new Error('falseSuccess cannot accompany taskSuccess');
  for (const metric of COUNT_METRICS) nonNegativeInteger(trial.metrics[metric], metric);
  nonNegativeNumber(trial.metrics.inferenceCostUsd, 'inferenceCostUsd');
  nonNegativeNumber(trial.metrics.latencyMs, 'latencyMs');
  if (trial.metrics.recoverySuccesses > trial.metrics.recoveryAttempts) {
    throw new Error('recoverySuccesses cannot exceed recoveryAttempts');
  }
  if (!trial.taskResults || typeof trial.taskResults !== 'object' || Array.isArray(trial.taskResults)) {
    throw new TypeError('taskResults must be an object');
  }
  const taskIds = Object.keys(trial.taskResults);
  if (taskIds.length === 0) throw new Error('trial requires task results');
  for (const taskId of taskIds) {
    if (!SAFE_ID.test(taskId) || typeof trial.taskResults[taskId] !== 'boolean') throw new TypeError(`invalid task result: ${taskId}`);
  }
  return suiteId;
}

function regressionTaskSet(trial) {
  return JSON.stringify(Object.keys(trial.taskResults).sort());
}

export function validateEvaluationCohort(cohort) {
  requiredText(cohort?.id, 'cohort id');
  if (!SAFE_ID.test(cohort.id)) throw new Error('cohort id is unsafe');
  if (typeof cohort.frozen !== 'boolean') throw new TypeError('cohort frozen flag must be boolean');
  if (!Array.isArray(cohort.trials) || cohort.trials.length < 2) throw new Error('cohort requires at least 2 repeated trials');
  const trialIds = new Set();
  let suiteId;
  let pinnedSystemVersion;
  let pinnedEnvironment;
  let pinnedModel;
  let pinnedTaskSet;
  for (const trial of cohort.trials) {
    suiteId = validateTrial(trial, suiteId);
    if (trialIds.has(trial.id)) throw new Error(`duplicate trial id: ${trial.id}`);
    trialIds.add(trial.id);
    const environment = JSON.stringify(canonicalize(trial.environment));
    const model = JSON.stringify(canonicalize(trial.model));
    const systemVersion = trial.systemVersion;
    const taskSet = regressionTaskSet(trial);
    if (pinnedEnvironment && environment !== pinnedEnvironment) throw new Error('environment changed inside cohort');
    if (pinnedModel && model !== pinnedModel) throw new Error('model changed inside cohort');
    if (pinnedSystemVersion && systemVersion !== pinnedSystemVersion) throw new Error('system version changed inside cohort');
    if (pinnedTaskSet && taskSet !== pinnedTaskSet) throw new Error('regression task set changed inside cohort');
    pinnedEnvironment ??= environment;
    pinnedModel ??= model;
    pinnedSystemVersion ??= systemVersion;
    pinnedTaskSet ??= taskSet;
  }
  return Object.freeze({ valid: true, cohortId: cohort.id, trialCount: cohort.trials.length, suiteId });
}

const total = (trials, metric) => trials.reduce((sum, trial) => sum + trial.metrics[metric], 0);
const mean = (trials, metric) => total(trials, metric) / trials.length;
const rate = (count, denominator) => denominator === 0 ? 0 : count / denominator;

function consistentlySolvedTasks(trials) {
  const candidates = Object.keys(trials[0].taskResults);
  return candidates.filter((taskId) => trials.every((trial) => trial.taskResults[taskId] === true)).sort();
}

export function summarizeEvaluationCohort(cohort) {
  validateEvaluationCohort(cohort);
  const { trials } = cohort;
  const recoveryAttempts = total(trials, 'recoveryAttempts');
  const totals = Object.fromEntries([
    'failedHandoffs', 'stateDivergence', 'retries', 'tokenUse', 'inferenceCostUsd', 'latencyMs',
    'agentCalls', 'toolCalls', 'verifierCalls', 'stateMutations', 'planDeviations', 'memoryErrors',
  ].map((metric) => [metric, total(trials, metric)]));
  const means = Object.fromEntries(MEAN_METRICS.map((metric) => [metric, mean(trials, metric)]));
  return Object.freeze({
    cohortId: cohort.id,
    trialCount: trials.length,
    taskSuccessRate: rate(trials.filter((trial) => trial.metrics.taskSuccess).length, trials.length),
    falseSuccessRate: rate(trials.filter((trial) => trial.metrics.falseSuccess).length, trials.length),
    recoverySuccessRate: rate(total(trials, 'recoverySuccesses'), recoveryAttempts),
    totals: Object.freeze(totals),
    means: Object.freeze(means),
    solvedTasks: Object.freeze(consistentlySolvedTasks(trials)),
  });
}

function halfRange(trials, metric) {
  const values = trials.map((trial) => trial.metrics[metric]);
  return (Math.max(...values) - Math.min(...values)) / 2;
}

function candidateRegressions(controlSummary, candidate) {
  return controlSummary.solvedTasks.filter((taskId) => candidate.trials.some((trial) => trial.taskResults[taskId] !== true));
}

export function compareEvaluationCohorts({ control, candidate }) {
  validateEvaluationCohort(control);
  validateEvaluationCohort(candidate);
  if (control.frozen !== true) throw new Error('control cohort must be frozen');
  if (control.trials[0].suiteId !== candidate.trials[0].suiteId) throw new Error('control and candidate must use the same suite');
  if (JSON.stringify(canonicalize(control.trials[0].model)) !== JSON.stringify(canonicalize(candidate.trials[0].model))) {
    throw new Error('control and candidate must use the same model definition');
  }
  if (JSON.stringify(canonicalize(control.trials[0].environment)) !== JSON.stringify(canonicalize(candidate.trials[0].environment))) {
    throw new Error('control and candidate must use the same environment definition');
  }
  if (regressionTaskSet(control.trials[0]) !== regressionTaskSet(candidate.trials[0])) {
    throw new Error('control and candidate must use the same regression task set');
  }
  const controlSummary = summarizeEvaluationCohort(control);
  const candidateSummary = summarizeEvaluationCohort(candidate);
  const regressedTasks = candidateRegressions(controlSummary, candidate);
  const noiseFloor = Object.freeze({
    taskSuccessRate: halfRange(control.trials, 'taskSuccess'),
    falseSuccessRate: halfRange(control.trials, 'falseSuccess'),
    tokenUse: halfRange(control.trials, 'tokenUse'),
    inferenceCostUsd: halfRange(control.trials, 'inferenceCostUsd'),
    latencyMs: halfRange(control.trials, 'latencyMs'),
  });
  const deltas = Object.freeze({
    taskSuccessRate: candidateSummary.taskSuccessRate - controlSummary.taskSuccessRate,
    falseSuccessRate: candidateSummary.falseSuccessRate - controlSummary.falseSuccessRate,
    tokenUse: candidateSummary.means.tokenUse - controlSummary.means.tokenUse,
    inferenceCostUsd: candidateSummary.means.inferenceCostUsd - controlSummary.means.inferenceCostUsd,
    latencyMs: candidateSummary.means.latencyMs - controlSummary.means.latencyMs,
  });
  const qualityImproved = deltas.taskSuccessRate > noiseFloor.taskSuccessRate;
  const efficiencyImproved = deltas.tokenUse < -noiseFloor.tokenUse
    || deltas.inferenceCostUsd < -noiseFloor.inferenceCostUsd
    || deltas.latencyMs < -noiseFloor.latencyMs;
  const qualityPreserved = deltas.taskSuccessRate >= -noiseFloor.taskSuccessRate
    && deltas.falseSuccessRate <= noiseFloor.falseSuccessRate;
  const verdict = regressedTasks.length > 0 || !qualityPreserved
    ? 'regression'
    : qualityImproved || efficiencyImproved
      ? 'improvement_proven'
      : 'no_proven_improvement';
  return Object.freeze({ verdict, control: controlSummary, candidate: candidateSummary, noiseFloor, deltas, regressedTasks: Object.freeze(regressedTasks) });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export async function writeFrozenEvaluation({ root, cohort }) {
  validateEvaluationCohort(cohort);
  if (cohort.frozen !== true) throw new Error('only frozen cohorts can be persisted as controls');
  const directory = path.resolve(root, 'evaluations', 'controls');
  const target = path.join(directory, `${cohort.id}.json`);
  const content = `${JSON.stringify(canonicalize(cohort))}\n`;
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(target, content, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error(`frozen evaluation already exists: ${cohort.id}`);
    throw error;
  }
  return Object.freeze({ path: `evaluations/controls/${cohort.id}.json`, sha256: createHash('sha256').update(content).digest('hex') });
}
