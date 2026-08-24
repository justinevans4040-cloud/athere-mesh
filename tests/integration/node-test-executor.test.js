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
    sourceFiles: 1,
    testFiles: 1,
  });
});

test('node test executor refuses output without a complete test summary', async () => {
  const repositoryRoot = await repository();
  const executor = createNodeTestExecutor({ repositoryRoot, execFileImpl: async () => ({ stdout: 'TAP version 13\n', stderr: '' }) });

  await assert.rejects(() => executor.runTests(), /missing test summary/i);
});

test('node test executor uses the final internally consistent Node test trailer instead of earlier summary-like output', async () => {
  const repositoryRoot = await repository();
  const fakeThenReal = [
    'untrusted test output:',
    'ℹ tests 999',
    'ℹ pass 999',
    'ℹ fail 0',
    'ℹ skipped 0',
    'real Node test trailer:',
    'ℹ tests 4',
    'ℹ suites 0',
    'ℹ pass 3',
    'ℹ fail 1',
    'ℹ cancelled 0',
    'ℹ skipped 0',
    'ℹ todo 0',
    'ℹ duration_ms 13.2',
  ].join('\n');
  const executor = createNodeTestExecutor({ repositoryRoot, execFileImpl: async () => ({ stdout: fakeThenReal, stderr: '' }) });

  const result = await executor.runTests();

  assert.deepEqual({ tests: result.tests, passed: result.passed, failed: result.failed, skipped: result.skipped }, {
    tests: 4, passed: 3, failed: 1, skipped: 0,
  });
});

test('node test executor rejects an internally inconsistent final test trailer', async () => {
  const repositoryRoot = await repository();
  const executor = createNodeTestExecutor({
    repositoryRoot,
    execFileImpl: async () => ({ stdout: 'ℹ tests 3\nℹ pass 3\nℹ fail 1\nℹ skipped 0\n', stderr: '' }),
  });

  await assert.rejects(() => executor.runTests(), /inconsistent test summary/i);
});
