import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compareEvaluationCohorts,
  validateEvaluationCohort,
} from '../../packages/evaluation/src/evaluation-harness.js';

const metrics = () => ({
  taskSuccess: true,
  falseSuccess: false,
  failedHandoffs: 0,
  stateDivergence: 0,
  retries: 0,
  recoveryAttempts: 0,
  recoverySuccesses: 0,
  tokenUse: 0,
  inferenceCostUsd: 0,
  latencyMs: 1,
  agentCalls: 0,
  toolCalls: 0,
  verifierCalls: 0,
  stateMutations: 0,
  planDeviations: 0,
  memoryErrors: 0,
});

const trial = (id, overrides = {}) => ({
  id,
  suiteId: 'titan-core-v1',
  systemVersion: 'commit-a',
  model: { provider: 'none', name: 'deterministic', version: '1' },
  environment: { id: 'node-test', version: '24.14.1', deterministic: true },
  seed: 42,
  metrics: metrics(),
  taskResults: { lifecycle: true, proof_integrity: true },
  ...overrides,
});

test('cohort rejects system-version drift across repeated trials', () => {
  assert.throws(
    () => validateEvaluationCohort({
      id: 'control',
      frozen: true,
      trials: [trial('c1'), trial('c2', { systemVersion: 'commit-b' })],
    }),
    /system version changed inside cohort/,
  );
});

test('cohort rejects seed drift across repeated trials', () => {
  assert.throws(
    () => validateEvaluationCohort({
      id: 'control-seed-drift',
      frozen: true,
      trials: [trial('c1'), trial('c2', { seed: 43 })],
    }),
    /seed changed inside cohort/,
  );
});

test('comparison rejects model or environment drift between control and candidate', () => {
  const control = { id: 'control', frozen: true, trials: [trial('c1'), trial('c2')] };
  const model = { provider: 'none', name: 'other-model', version: '1' };
  const candidateWithDifferentModel = {
    id: 'candidate-model',
    frozen: false,
    trials: [trial('m1', { systemVersion: 'commit-b', model }), trial('m2', { systemVersion: 'commit-b', model })],
  };
  assert.throws(
    () => compareEvaluationCohorts({ control, candidate: candidateWithDifferentModel }),
    /same model definition/,
  );

  const environment = { id: 'different-environment', version: '24.14.1', deterministic: true };
  const candidateWithDifferentEnvironment = {
    id: 'candidate-environment',
    frozen: false,
    trials: [
      trial('e1', { systemVersion: 'commit-b', environment }),
      trial('e2', { systemVersion: 'commit-b', environment }),
    ],
  };
  assert.throws(
    () => compareEvaluationCohorts({ control, candidate: candidateWithDifferentEnvironment }),
    /same environment definition/,
  );
});
