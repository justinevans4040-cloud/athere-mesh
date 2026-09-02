import test from 'node:test';
import assert from 'node:assert/strict';

import { collectEvaluationCohort } from '../../packages/evaluation/src/evaluation-runner.js';

test('collector executes every pinned task for each repeated trial and records measured results', async () => {
  const calls = [];
  let time = 1_000;
  const cohort = await collectEvaluationCohort({
    id: 'control-core-1',
    suiteId: 'titan-core-v1',
    systemVersion: 'commit-ed49a1e',
    repetitions: 2,
    seed: 42,
    model: { provider: 'none', name: 'deterministic-node', version: '24.14.1' },
    environment: { id: 'windows-node-test', version: '24.14.1', deterministic: true },
    tasks: [
      { id: 'mission_contract', args: ['--test', 'tests/contract/mission-contract.test.js'] },
      { id: 'proof_integrity', args: ['--test', 'tests/integration/proof-integrity.test.js'] },
    ],
    now: () => (time += 25),
    runTask: async ({ task, trialIndex }) => {
      calls.push({ taskId: task.id, trialIndex });
      return { exitCode: 0, tests: 4, passed: 4, failed: 0, skipped: 0 };
    },
  });

  assert.deepEqual(calls, [
    { taskId: 'mission_contract', trialIndex: 0 },
    { taskId: 'proof_integrity', trialIndex: 0 },
    { taskId: 'mission_contract', trialIndex: 1 },
    { taskId: 'proof_integrity', trialIndex: 1 },
  ]);
  assert.equal(cohort.frozen, true);
  assert.equal(cohort.trials.length, 2);
  assert.deepEqual(cohort.trials[0].taskResults, { mission_contract: true, proof_integrity: true });
  assert.deepEqual(cohort.trials[0].metrics, {
    taskSuccess: true,
    falseSuccess: false,
    failedHandoffs: 0,
    stateDivergence: 0,
    retries: 0,
    recoveryAttempts: 0,
    recoverySuccesses: 0,
    tokenUse: 0,
    inferenceCostUsd: 0,
    latencyMs: 50,
    agentCalls: 0,
    toolCalls: 2,
    verifierCalls: 2,
    stateMutations: 0,
    planDeviations: 0,
    memoryErrors: 0,
  });
});

test('collector records a failed task without falsely reporting trial success', async () => {
  let call = 0;
  const cohort = await collectEvaluationCohort({
    id: 'control-failure-1',
    suiteId: 'titan-core-v1',
    systemVersion: 'commit-ed49a1e',
    repetitions: 2,
    seed: 42,
    model: { provider: 'none', name: 'deterministic-node', version: '24.14.1' },
    environment: { id: 'windows-node-test', version: '24.14.1', deterministic: true },
    tasks: [{ id: 'proof_integrity', args: ['--test', 'tests/integration/proof-integrity.test.js'] }],
    now: (() => { let time = 0; return () => ++time; })(),
    runTask: async () => ({ exitCode: call++ === 0 ? 1 : 0, tests: 1, passed: 0, failed: 1, skipped: 0 }),
  });

  assert.equal(cohort.trials[0].metrics.taskSuccess, false);
  assert.equal(cohort.trials[0].metrics.falseSuccess, false);
  assert.deepEqual(cohort.trials[0].taskResults, { proof_integrity: false });
});
