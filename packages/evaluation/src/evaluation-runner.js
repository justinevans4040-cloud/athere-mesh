import { validateEvaluationCohort } from './evaluation-harness.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${label} is required`);
  return value.trim();
}

function validateTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) throw new TypeError('tasks must be a non-empty array');
  const ids = new Set();
  return tasks.map((task) => {
    const id = requireText(task?.id, 'task id');
    if (!SAFE_ID.test(id)) throw new TypeError(`unsafe task id: ${id}`);
    if (ids.has(id)) throw new Error(`duplicate task id: ${id}`);
    ids.add(id);
    if (!Array.isArray(task.args) || task.args.length === 0 || task.args.some((arg) => typeof arg !== 'string')) {
      throw new TypeError(`task args must be a non-empty string array: ${id}`);
    }
    return Object.freeze({ id, args: Object.freeze([...task.args]) });
  });
}

function validateResult(result, taskId) {
  for (const field of ['exitCode', 'tests', 'passed', 'failed', 'skipped']) {
    if (!Number.isSafeInteger(result?.[field]) || result[field] < 0) {
      throw new TypeError(`${taskId} result ${field} must be a non-negative integer`);
    }
  }
  if (result.tests !== result.passed + result.failed + result.skipped) {
    throw new Error(`${taskId} result totals are inconsistent`);
  }
  return result.exitCode === 0 && result.failed === 0 && result.tests > 0;
}

export async function collectEvaluationCohort({
  id,
  suiteId,
  systemVersion,
  repetitions,
  seed,
  model,
  environment,
  tasks,
  runTask,
  now = Date.now,
} = {}) {
  const cohortId = requireText(id, 'cohort id');
  if (!SAFE_ID.test(cohortId)) throw new TypeError('cohort id is unsafe');
  const pinnedSuiteId = requireText(suiteId, 'suite id');
  const pinnedSystemVersion = requireText(systemVersion, 'system version');
  if (!Number.isSafeInteger(repetitions) || repetitions < 2) throw new TypeError('repetitions must be at least 2');
  if (!Number.isSafeInteger(seed)) throw new TypeError('seed must be a safe integer');
  if (typeof runTask !== 'function') throw new TypeError('runTask must be a function');
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  const pinnedTasks = validateTasks(tasks);
  const trials = [];

  for (let trialIndex = 0; trialIndex < repetitions; trialIndex += 1) {
    const taskResults = {};
    let latencyMs = 0;
    for (const task of pinnedTasks) {
      const startedAt = now();
      const result = await runTask({ task, trialIndex, seed });
      const finishedAt = now();
      if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt) || finishedAt < startedAt) {
        throw new Error('clock produced an invalid duration');
      }
      latencyMs += finishedAt - startedAt;
      taskResults[task.id] = validateResult(result, task.id);
    }
    const taskSuccess = Object.values(taskResults).every(Boolean);
    trials.push(Object.freeze({
      id: `${cohortId}-trial-${trialIndex + 1}`,
      suiteId: pinnedSuiteId,
      systemVersion: pinnedSystemVersion,
      model: structuredClone(model),
      environment: structuredClone(environment),
      seed,
      metrics: Object.freeze({
        taskSuccess,
        falseSuccess: false,
        failedHandoffs: 0,
        stateDivergence: 0,
        retries: 0,
        recoveryAttempts: 0,
        recoverySuccesses: 0,
        tokenUse: 0,
        inferenceCostUsd: 0,
        latencyMs,
        agentCalls: 0,
        toolCalls: pinnedTasks.length,
        verifierCalls: pinnedTasks.length,
        stateMutations: 0,
        planDeviations: 0,
        memoryErrors: 0,
      }),
      taskResults: Object.freeze(taskResults),
    }));
  }

  const cohort = Object.freeze({ id: cohortId, frozen: true, trials: Object.freeze(trials) });
  validateEvaluationCohort(cohort);
  return cohort;
}
