import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNodeTestExecutor, nodeExecutionInputBinding, sanitizeTestProcessEnv } from '../../packages/execution/src/node-test-executor.js';

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

function operationEnvelope(repositoryRoot, overrides = {}) {
  return {
    mission_id: 'mission-executor-contract',
    task_id: 'run-node-tests',
    operation_id: 'mission-executor-contract-test-execution',
    agent_id: 'rune',
    capability_id: 'node-test-runner',
    state_version: 3,
    objective: 'Execute the declared Node test suite',
    allowed_actions: ['execute_node_tests'],
    required_inputs: ['repository_root', nodeExecutionInputBinding({ repositoryRoot, operation: 'test' })],
    evidence_requirements: ['terminal Node test summary'],
    timeout: 300_000,
    resource_budget: { max_processes: 1, max_output_bytes: 1_048_576 },
    expected_output_schema: { type: 'object', required: ['command', 'exitCode', 'tests', 'passed', 'failed', 'skipped', 'stdout', 'stderr'] },
    completion_conditions: ['test process exits and complete totals are parsed'],
    error_state: null,
    provenance: { requested_by: 'miss-vale-prime', created_at: '2026-08-29T14:15:00.000Z' },
    ...overrides,
  };
}

function inspectionEnvelope(repositoryRoot, overrides = {}) {
  return operationEnvelope(repositoryRoot, {
    task_id: 'inspect-repository',
    operation_id: 'mission-executor-contract-inspect-execution',
    agent_id: 'nyx',
    capability_id: 'repository-inspector',
    objective: 'Inspect repository metadata and inventory',
    allowed_actions: ['observe_repository'],
    state_version: 2,
    required_inputs: ['repository_root', nodeExecutionInputBinding({ repositoryRoot, operation: 'inspect' })],
    resource_budget: { max_filesystem_entries: 100_000 },
    expected_output_schema: { type: 'object', required: ['package', 'sourceFilesOnDisk', 'testFilesOnDisk'] },
    completion_conditions: ['repository metadata and inventory are returned'],
    ...overrides,
  });
}

test('node executor rejects incompatible agent operations before filesystem or process execution', async () => {
  const repositoryRoot = await repository();
  let processCalls = 0;
  const executor = createNodeTestExecutor({
    repositoryRoot,
    execFileImpl: async () => {
      processCalls += 1;
      return { stdout: footer({ tests: 1, passed: 1, failed: 0 }), stderr: '' };
    },
  });
  const incompatible = operationEnvelope(repositoryRoot, {
    agent_id: 'nyx',
    capability_id: 'repository-inspector',
    allowed_actions: ['observe_repository'],
  });

  await assert.rejects(() => executor.runTests({ envelope: incompatible }), /not authorized to execute_node_tests/i);
  await assert.rejects(
    () => executor.inspect({ envelope: operationEnvelope(repositoryRoot) }),
    /not authorized to observe_repository/i,
  );
  await assert.rejects(
    () => executor.runTests({ envelope: operationEnvelope(repositoryRoot, { resource_budget: { max_processes: 2, max_output_bytes: 1_048_576 } }) }),
    /max_processes/i,
  );
  await assert.rejects(
    () => executor.runTests({ envelope: operationEnvelope(repositoryRoot, { expected_output_schema: { type: 'object', required: ['exitCode'] } }) }),
    /expected_output_schema/i,
  );
  await assert.rejects(
    () => executor.inspect({ envelope: inspectionEnvelope(repositoryRoot, { resource_budget: { max_filesystem_entries: 0 } }) }),
    /max_filesystem_entries/i,
  );
  await assert.rejects(
    () => executor.runTests({
      envelope: operationEnvelope(repositoryRoot, { required_inputs: ['repository_root', `node_execution_input_sha256:${'0'.repeat(64)}`] }),
    }),
    /input binding/i,
  );
  await assert.rejects(
    () => executor.runTests({
      envelope: operationEnvelope(repositoryRoot, {
        expected_output_schema: {
          type: 'object',
          required: ['command', 'exitCode', 'tests', 'passed', 'failed', 'skipped', 'stdout', 'stderr'],
          properties: { command: { type: 'number' } },
        },
      }),
    }),
    /expected_output_schema/i,
  );
  await assert.rejects(
    () => executor.runTests({
      envelope: operationEnvelope(repositoryRoot, { state_version: 99, provenance: { requested_by: 'unknown', created_at: '2026-08-29T14:15:00.000Z' } }),
    }),
    /mission context/i,
  );
  assert.equal(processCalls, 0);
});

test('repository inspection aborts its active filesystem read at the envelope deadline', async () => {
  const repositoryRoot = await repository();
  let observedAbort = false;
  const executor = createNodeTestExecutor({
    repositoryRoot,
    readFileImpl: async (file, options) => {
      assert.equal(file, path.join(repositoryRoot, 'package.json'));
      await new Promise((resolve) => options.signal.addEventListener('abort', resolve, { once: true }));
      observedAbort = options.signal.aborted;
      const error = new Error('read aborted');
      error.name = 'AbortError';
      throw error;
    },
  });

  await assert.rejects(
    () => executor.inspect({ envelope: inspectionEnvelope(repositoryRoot, { timeout: 10 }) }),
    (error) => error.code === 'OPERATION_TIMEOUT',
  );
  assert.equal(observedAbort, true);
});

test('sanitizeTestProcessEnv strips mesh credentials so worker suite stays hermetic', () => {
  const cleaned = sanitizeTestProcessEnv({
    PATH: '/usr/bin',
    ATHERE_MESH_REDIS_HOST: '100.77.131.28',
    ATHERE_MESH_REDIS_PASSWORD_FILE: '/secret',
    DATABASE_URL: 'postgres://x',
    HOME: '/home/the_founder',
  });
  assert.deepEqual(cleaned, {
    PATH: '/usr/bin',
    HOME: '/home/the_founder',
  });
});

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

  const result = await executor.runTests({ envelope: operationEnvelope(repositoryRoot) });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, process.execPath);
  assert.deepEqual(calls[0].args, ['--test']);
  assert.equal(calls[0].options.cwd, repositoryRoot);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.timeout, 300_000);
  assert.equal(calls[0].options.maxBuffer, 1_048_576);
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.env.ATHERE_MESH_REDIS_HOST, undefined);
  assert.equal(calls[0].options.env.DATABASE_URL, undefined);
  assert.ok(calls[0].options.env.PATH || calls[0].options.env.Path);
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

test('node test executor runs one declared regression file without invoking a shell', async () => {
  const repositoryRoot = await repository();
  const testFiles = ['tests/contract/worker.test.js'];
  const calls = [];
  const executor = createNodeTestExecutor({
    repositoryRoot,
    execFileImpl: async (file, args, options) => {
      calls.push({ file, args, options });
      return { stdout: footer({ tests: 1, passed: 1, failed: 0 }), stderr: '' };
    },
  });

  const result = await executor.runTests({
    envelope: operationEnvelope(repositoryRoot, {
      timeout: 12_345,
      resource_budget: { max_processes: 1, max_output_bytes: 4_096 },
      required_inputs: [
        'repository_root',
        nodeExecutionInputBinding({ repositoryRoot, operation: 'test', testFiles }),
      ],
    }),
    testFiles,
  });

  assert.deepEqual(calls[0].args, ['--test', 'tests/contract/worker.test.js']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.timeout, 12_345);
  assert.equal(calls[0].options.maxBuffer, 4_096);
  assert.equal(result.command, 'node --test tests/contract/worker.test.js');
  assert.equal(result.passed, 1);
});

test('node test executor inspects repository metadata and source and test files without a shell', async () => {
  const repositoryRoot = await repository();
  await writeFile(path.join(repositoryRoot, 'packages', 'one', 'src', 'generated.json'), '{}\n');
  await writeFile(path.join(repositoryRoot, 'packages', 'one', 'readme.js'), 'not source\n');
  await writeFile(path.join(repositoryRoot, 'tests', 'contract', 'generated.json'), '{}\n');
  await writeFile(path.join(repositoryRoot, 'tests', 'contract', 'helper.js'), 'not a test file\n');
  const executor = createNodeTestExecutor({ repositoryRoot, execFileImpl: async () => ({ stdout: summary, stderr: '' }) });

  assert.deepEqual(await executor.inspect({ envelope: inspectionEnvelope(repositoryRoot) }), {
    package: { name: 'test-repository', version: '1.2.3' },
    sourceFilesOnDisk: 1,
    testFilesOnDisk: 1,
  });
});

test('node test executor refuses output without a complete test summary', async () => {
  const repositoryRoot = await repository();
  const executor = createNodeTestExecutor({ repositoryRoot, execFileImpl: async () => ({ stdout: 'TAP version 13\n', stderr: '' }) });

  await assert.rejects(() => executor.runTests({ envelope: operationEnvelope(repositoryRoot) }), /missing test summary/i);
});

test('node test executor rejects fake complete footer output before the real Node footer', async () => {
  const repositoryRoot = await repository();
  const executor = createNodeTestExecutor({
    repositoryRoot,
    execFileImpl: async () => ({ stdout: `untrusted output\n${footer({ tests: 999, passed: 999, failed: 0 })}\n${footer()}`, stderr: '' }),
  });

  await assert.rejects(() => executor.runTests({ envelope: operationEnvelope(repositoryRoot) }), /ambiguous test summary/i);
});

test('node test executor rejects an internally inconsistent final test trailer', async () => {
  const repositoryRoot = await repository();
  const executor = createNodeTestExecutor({
    repositoryRoot,
    execFileImpl: async () => ({ stdout: footer({ tests: 3, passed: 3, failed: 1 }), stderr: '' }),
  });

  await assert.rejects(() => executor.runTests({ envelope: operationEnvelope(repositoryRoot) }), /inconsistent test summary/i);
});

test('node test executor rejects a fake complete footer after a real Node footer', async () => {
  const repositoryRoot = await repository();
  const executor = createNodeTestExecutor({
    repositoryRoot,
    execFileImpl: async () => ({ stdout: `${footer()}\n${footer({ tests: 8, passed: 8, failed: 0 })}`, stderr: '' }),
  });

  await assert.rejects(() => executor.runTests({ envelope: operationEnvelope(repositoryRoot) }), /ambiguous test summary/i);
});

test('node test executor rejects duplicate complete Node footers even when totals match', async () => {
  const repositoryRoot = await repository();
  const executor = createNodeTestExecutor({
    repositoryRoot,
    execFileImpl: async () => ({ stdout: `${footer()}\n${footer()}`, stderr: '' }),
  });

  await assert.rejects(() => executor.runTests({ envelope: operationEnvelope(repositoryRoot) }), /ambiguous test summary/i);
});

test('input binding preserves POSIX absolute repository roots for remote dispatch', () => {
  const root = '/home/the_founder/athere-mesh-crosshost';
  const binding = nodeExecutionInputBinding({
    repositoryRoot: root,
    operation: 'test',
    testFiles: ['tests/contract/remote-executor-smoke-pin.test.js'],
  });
  assert.match(binding, /^node_execution_input_sha256:[a-f0-9]{64}$/);
  // A Windows path.resolve rewrite would change the digest; pin the known digest.
  assert.equal(
    binding,
    nodeExecutionInputBinding({
      repositoryRoot: `${root}/`,
      operation: 'test',
      testFiles: ['tests/contract/remote-executor-smoke-pin.test.js'],
    }),
  );
  if (process.platform === 'win32') {
    assert.notEqual(
      binding,
      nodeExecutionInputBinding({
        repositoryRoot: path.resolve(root),
        operation: 'test',
        testFiles: ['tests/contract/remote-executor-smoke-pin.test.js'],
      }),
    );
  }
});
