import test from 'node:test';
import assert from 'node:assert/strict';

import { collectAndFreezeNodeControl } from '../../packages/evaluation/src/node-control-collector.js';

test('node control collector runs the pinned suite repeatedly and freezes exactly that cohort', async () => {
  const executed = [];
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
      async runTests({ testFiles }) {
        executed.push(testFiles);
        return { exitCode: 0, tests: 1, passed: 1, failed: 0, skipped: 0 };
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
  assert.equal(frozen.root, 'C:/athere');
  assert.equal(frozen.cohort.trials[0].environment.version, '24.14.1');
  assert.equal(frozen.cohort.trials[0].environment.id, 'win32-x64-node');
  assert.equal(result.sha256, 'a'.repeat(64));
});
