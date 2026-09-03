import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { collectAndFreezeNodeControl } from '../../packages/evaluation/src/node-control-collector.js';
import { createNodeTestExecutor } from '../../packages/execution/src/node-test-executor.js';

test('node control collector runs the pinned suite repeatedly and freezes exactly that cohort', async () => {
  const executed = [];
  const envelopes = [];
  let frozen;
  const result = await collectAndFreezeNodeControl({
    root: 'C:/athere',
    cohortId: 'titan-core-control-e07d708',
    suite: {
      id: 'titan-core-v1',
      tasks: [
        { id: 'mission_contract', file: 'tests/contract/mission-contract.test.js' },
        { id: 'proof_integrity', file: 'tests/integration/proof-integrity.test.js' },
      ],
    },
    systemVersion: 'e07d708',
    repetitions: 2,
    seed: 42,
    nodeVersion: '24.14.1',
    platform: 'win32-x64',
    now: (() => { let time = 0; return () => ++time; })(),
    executor: {
      async runTests({ envelope, testFiles }) {
        if (!envelope) throw new Error('missing universal envelope');
        envelopes.push(envelope);
        executed.push(testFiles);
        return {
          command: 'node --test selected-file', exitCode: 0, tests: 1, passed: 1, failed: 0, skipped: 0,
          stdout: 'complete', stderr: '',
        };
      },
    },
    writeFrozen: async ({ root, cohort }) => {
      frozen = { root, cohort };
      return { path: `evaluations/controls/${cohort.id}.json`, sha256: 'a'.repeat(64) };
    },
  });

  assert.deepEqual(executed, [
    ['tests/contract/mission-contract.test.js'],
    ['tests/integration/proof-integrity.test.js'],
    ['tests/contract/mission-contract.test.js'],
    ['tests/integration/proof-integrity.test.js'],
  ]);
  assert.deepEqual(envelopes.map((envelope) => ({
    mission_id: envelope.mission_id,
    task_id: envelope.task_id,
    agent_id: envelope.agent_id,
    capability_id: envelope.capability_id,
    state_version: envelope.state_version,
    allowed_actions: envelope.allowed_actions,
    operation_id_length: envelope.operation_id.length,
  })), [
    { mission_id: 'evaluation-titan-core-control-e07d708', task_id: 'run-node-tests', agent_id: 'rune', capability_id: 'node-test-runner', state_version: 1, allowed_actions: ['execute_node_tests'], operation_id_length: 40 },
    { mission_id: 'evaluation-titan-core-control-e07d708', task_id: 'run-node-tests', agent_id: 'rune', capability_id: 'node-test-runner', state_version: 1, allowed_actions: ['execute_node_tests'], operation_id_length: 40 },
    { mission_id: 'evaluation-titan-core-control-e07d708', task_id: 'run-node-tests', agent_id: 'rune', capability_id: 'node-test-runner', state_version: 2, allowed_actions: ['execute_node_tests'], operation_id_length: 40 },
    { mission_id: 'evaluation-titan-core-control-e07d708', task_id: 'run-node-tests', agent_id: 'rune', capability_id: 'node-test-runner', state_version: 2, allowed_actions: ['execute_node_tests'], operation_id_length: 40 },
  ]);
  assert.equal(frozen.root, 'C:/athere');
  assert.equal(frozen.cohort.trials[0].environment.version, '24.14.1');
  assert.equal(frozen.cohort.trials[0].environment.id, 'win32-x64-node');
  assert.equal(result.sha256, 'a'.repeat(64));
});

test('node control collector envelopes are accepted by the production Node executor', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'titan-control-envelope-'));
  await mkdir(path.join(root, 'tests', 'contract'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'control-fixture', version: '1.0.0' }));
  await writeFile(path.join(root, 'tests', 'contract', 'worker.test.js'), 'export {};\n');
  const footer = [
    'ℹ tests 1', 'ℹ suites 0', 'ℹ pass 1', 'ℹ fail 0', 'ℹ cancelled 0',
    'ℹ skipped 0', 'ℹ todo 0', 'ℹ duration_ms 1',
  ].join('\n');
  const executor = createNodeTestExecutor({
    repositoryRoot: root,
    execFileImpl: async () => ({ stdout: footer, stderr: '' }),
  });

  const result = await collectAndFreezeNodeControl({
    root,
    cohortId: 'control-envelope-integration',
    suite: { id: 'suite-v1', tasks: [{ id: 'worker', file: 'tests/contract/worker.test.js' }] },
    systemVersion: 'a'.repeat(40),
    repetitions: 2,
    seed: 42,
    nodeVersion: '24.14.1',
    platform: 'win32-x64',
    executor,
    now: (() => { let time = 0; return () => ++time; })(),
    writeFrozen: async () => ({ path: 'control.json', sha256: 'b'.repeat(64) }),
  });

  assert.equal(result.cohort.trials.every((trial) => trial.metrics.taskSuccess), true);
});

test('node control collector rejects executor output that violates its declared envelope schema', async () => {
  await assert.rejects(
    () => collectAndFreezeNodeControl({
      root: 'C:/athere',
      cohortId: 'invalid-control-result',
      suite: { id: 'suite-v1', tasks: [{ id: 'worker', file: 'tests/contract/worker.test.js' }] },
      systemVersion: 'a'.repeat(40),
      repetitions: 2,
      seed: 42,
      nodeVersion: '24.14.1',
      platform: 'win32-x64',
      executor: {
        async runTests() {
          return { exitCode: 0, tests: 1, passed: 1, failed: 0, skipped: 0 };
        },
      },
      writeFrozen: async () => ({ path: 'invalid.json', sha256: 'c'.repeat(64) }),
    }),
    /invalid Node test result/i,
  );
});
