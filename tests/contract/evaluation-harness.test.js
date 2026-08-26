import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  compareEvaluationCohorts,
  summarizeEvaluationCohort,
  validateEvaluationCohort,
  writeFrozenEvaluation,
} from '../../packages/evaluation/src/evaluation-harness.js';

const metrics = (overrides = {}) => ({
  taskSuccess: true,
  falseSuccess: false,
  failedHandoffs: 0,
  stateDivergence: 0,
  retries: 1,
  recoveryAttempts: 1,
  recoverySuccesses: 1,
  tokenUse: 120,
  inferenceCostUsd: 0.02,
  latencyMs: 800,
  agentCalls: 2,
  toolCalls: 3,
  verifierCalls: 1,
  stateMutations: 4,
  planDeviations: 0,
  memoryErrors: 0,
  ...overrides,
});

const trial = (id, metricOverrides = {}, taskResults = { lifecycle: true, proof_integrity: true }) => ({
  id,
  suiteId: 'titan-core-v1',
  systemVersion: 'commit-abc123',
  model: { provider: 'ollama', name: 'llama3.2', version: '3b-q4_0' },
  environment: { id: 'node-test', version: '24.14.1', deterministic: true },
  seed: 42,
  metrics: metrics(metricOverrides),
  taskResults,
});

test('cohort validation requires repeated pinned trials and summarizes every required metric', () => {
  const cohort = { id: 'control-1', frozen: true, trials: [trial('c1'), trial('c2', { latencyMs: 1000, tokenUse: 140 })] };

  assert.equal(validateEvaluationCohort(cohort).valid, true);
  assert.deepEqual(summarizeEvaluationCohort(cohort), {
    cohortId: 'control-1',
    trialCount: 2,
    taskSuccessRate: 1,
    falseSuccessRate: 0,
    recoverySuccessRate: 1,
    totals: {
      failedHandoffs: 0,
      stateDivergence: 0,
      retries: 2,
      tokenUse: 260,
      inferenceCostUsd: 0.04,
      latencyMs: 1800,
      agentCalls: 4,
      toolCalls: 6,
      verifierCalls: 2,
      stateMutations: 8,
      planDeviations: 0,
      memoryErrors: 0,
    },
    means: { tokenUse: 130, inferenceCostUsd: 0.02, latencyMs: 900, agentCalls: 2, toolCalls: 3, verifierCalls: 1, stateMutations: 4 },
    solvedTasks: ['lifecycle', 'proof_integrity'],
  });
});

test('cohort validation rejects single trials and unpinned model versions', () => {
  assert.throws(() => validateEvaluationCohort({ id: 'one', frozen: true, trials: [trial('only')] }), /at least 2 repeated trials/);
  const unpinned = trial('c2');
  unpinned.model.version = '';
  assert.throws(() => validateEvaluationCohort({ id: 'bad', frozen: true, trials: [trial('c1'), unpinned] }), /model version/);
});

test('cohort validation rejects drift inside a repeated-trial control', () => {
  const drifted = trial('c2');
  drifted.environment.version = '25.0.0';
  assert.throws(
    () => validateEvaluationCohort({ id: 'drifted', frozen: true, trials: [trial('c1'), drifted] }),
    /environment changed inside cohort/,
  );

  assert.throws(
    () => validateEvaluationCohort({
      id: 'false-success',
      frozen: true,
      trials: [trial('c1'), trial('c2', { taskSuccess: true, falseSuccess: true })],
    }),
    /falseSuccess cannot accompany taskSuccess/,
  );
});

test('comparison refuses improvement claims inside the measured noise floor', () => {
  const control = { id: 'control', frozen: true, trials: [trial('c1', { latencyMs: 800 }), trial('c2', { latencyMs: 1000 })] };
  const candidate = { id: 'candidate', frozen: false, trials: [trial('n1', { latencyMs: 850 }), trial('n2', { latencyMs: 850 })] };

  const report = compareEvaluationCohorts({ control, candidate });

  assert.equal(report.verdict, 'no_proven_improvement');
  assert.equal(report.noiseFloor.latencyMs, 100);
  assert.equal(report.deltas.latencyMs, -50);
  assert.deepEqual(report.regressedTasks, []);
});

test('comparison rejects a candidate that regresses a previously solved task', () => {
  const control = { id: 'control', frozen: true, trials: [trial('c1'), trial('c2')] };
  const candidate = {
    id: 'candidate',
    frozen: false,
    trials: [trial('n1', {}, { lifecycle: true, proof_integrity: false }), trial('n2', {}, { lifecycle: true, proof_integrity: false })],
  };

  const report = compareEvaluationCohorts({ control, candidate });

  assert.equal(report.verdict, 'regression');
  assert.deepEqual(report.regressedTasks, ['proof_integrity']);
});

test('frozen evaluation artifacts are immutable and content-addressed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-evaluation-'));
  const cohort = { id: 'control-1', frozen: true, trials: [trial('c1'), trial('c2')] };

  const first = await writeFrozenEvaluation({ root, cohort });
  const content = await readFile(path.join(root, first.path), 'utf8');

  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.parse(content).id, 'control-1');
  await assert.rejects(writeFrozenEvaluation({ root, cohort }), /already exists/);
});
