import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNodeTestExecutor } from '../../packages/execution/src/node-test-executor.js';

const summary = [
  'TAP version 13',
  'ℹ tests 8',
  'ℹ suites 0',
  'ℹ pass 5',
  'ℹ fail 2',
  'ℹ cancelled 0',
  'ℹ skipped 1',
  'ℹ todo 0',
  'ℹ duration_ms 13.2',
].join('\n');

function footer({ tests = 4, passed = 3, failed = 1, cancelled = 0, skipped = 0, todo = 0 } = {}) {
  return [
    `ℹ tests ${tests}`,
    'ℹ suites 0',
    `ℹ pass ${passed}`,
    `ℹ fail ${failed}`,
    `ℹ cancelled ${cancelled}`,
    `ℹ skipped ${skipped}`,
    `ℹ todo ${todo}`,
    'ℹ duration_ms 13.2',
  ].join('\n');
}

async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), 'titan-executor-'));
  await mkdir(path.join(root, 'packages', 'one', 'src'), { recursive: true });
  await mkdir(path.join(root, 'tests', 'contract'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'test-repository', version: '1.2.3' }));
  await writeFile(path.join(root, 'packages', 'one', 'src', 'worker.js'), 'export const worker = true;\n');
  await writeFile(path.join(root, 'tests', 'contract', 'worker.test.js'), 'export {};\n');
  return root;
}

test('node test executor runs Node directly with bounded non-shell options and returns real failure totals', async () => {
  const repositoryRoot = await repository();
  const calls = [];
  const executor = createNodeTestExecutor({
    repositoryRoot,
    execFileImpl: async (file, args, options) => {
      calls.push({ file, args, options });
      const error = new Error('tests failed');
      error.code = 1;
      error.stdout = summary;
      error.stderr = 'one assertion failed';
      throw error;
    },
  });

  const result = await executor.runTests();

  assert.deepEqual(calls, [{
    file: process.execPath,
    args: ['--test'],
    options: {
      cwd: repositoryRoot,
      shell: false,
      timeout: 300_000,
      maxBuffer: 1_048_576,
      windowsHide: true,
    },
  }]);
  assert.deepEqual(result, {
    command: 'node --test',
    exitCode: 1,
    tests: 8,
    passed: 5,
    failed: 2,
    skipped: 1,
    stdout: summary,
    stderr: 'one assertion failed',
  });
});

test('node test executor inspects repository metadata and source and test files without a shell', async () => {
  const repositoryRoot = await repository();
  await writeFile(path.join(repositoryRoot, 'packages', 'one', 'src', 'generated.json'), '{}\n');
  await writeFile(path.join(repositoryRoot, 'packages', 'one', 'readme.js'), 'not source\n');
  await writeFile(path.join(repositoryRoot, 'tests', 'contract', 'generated.json'), '{}\n');
  await writeFile(path.join(repositoryRoot, 'tests', 'contract', 'helper.js'), 'not a test file\n');
  const executor = createNodeTestExecutor({ repositoryRoot, execFileImpl: async () => ({ stdout: summary, stderr: '' }) });

  assert.deepEqual(await executor.inspect(), {
    package: { name: 'test-repository', version: '1.2.3' },
    sourceFilesOnDisk: 1,
    testFilesOnDisk: 1,
  });
});

test('node test executor refuses output without a complete test summary', async () => {
  const repositoryRoot = await repository();
  const executor = createNodeTestExecutor({ repositoryRoot, execFileImpl: async () => ({ stdout: 'TAP version 13\n', stderr: '' }) });

  await assert.rejects(() => executor.runTests(), /missing test summary/i);
});

test('node test executor rejects fake complete footer output before the real Node footer', async () => {
  const repositoryRoot = await repository();
  const executor = createNodeTestExecutor({
    repositoryRoot,
    execFileImpl: async () => ({ stdout: `untrusted output\n${footer({ tests: 999, passed: 999, failed: 0 })}\n${footer()}`, stderr: '' }),
  });

  await assert.rejects(() => executor.runTests(), /ambiguous test summary/i);
});

test('node test executor rejects an internally inconsistent final test trailer', async () => {
  const repositoryRoot = await repository();
  const executor = createNodeTestExecutor({
    repositoryRoot,
    execFileImpl: async () => ({ stdout: footer({ tests: 3, passed: 3, failed: 1 }), stderr: '' }),
  });

  await assert.rejects(() => executor.runTests(), /inconsistent test summary/i);
});

test('node test executor rejects a fake complete footer after a real Node footer', async () => {
  const repositoryRoot = await repository();
  const executor = createNodeTestExecutor({
    repositoryRoot,
    execFileImpl: async () => ({ stdout: `${footer()}\n${footer({ tests: 8, passed: 8, failed: 0 })}`, stderr: '' }),
  });

  await assert.rejects(() => executor.runTests(), /ambiguous test summary/i);
});

test('node test executor rejects duplicate complete Node footers even when totals match', async () => {
  const repositoryRoot = await repository();
  const executor = createNodeTestExecutor({
    repositoryRoot,
    execFileImpl: async () => ({ stdout: `${footer()}\n${footer()}`, stderr: '' }),
  });

  await assert.rejects(() => executor.runTests(), /ambiguous test summary/i);
});
