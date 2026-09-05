import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseAgentEnvelope } from '../../contracts/src/agent-envelope.js';

const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_BYTES = 1_048_576;
const defaultExecFile = promisify(execFileCallback);

const OPERATIONS = Object.freeze({
  inspect: Object.freeze({
    taskId: 'inspect-repository',
    agentId: 'nyx',
    capabilityId: 'repository-inspector',
    action: 'observe_repository',
    missionStateVersion: 2,
    operationSuffix: 'inspect-execution',
    outputFields: Object.freeze(['package', 'sourceFilesOnDisk', 'testFilesOnDisk']),
  }),
  test: Object.freeze({
    taskId: 'run-node-tests',
    agentId: 'rune',
    capabilityId: 'node-test-runner',
    action: 'execute_node_tests',
    missionStateVersion: 3,
    operationSuffix: 'test-execution',
    outputFields: Object.freeze(['command', 'exitCode', 'tests', 'passed', 'failed', 'skipped', 'stdout', 'stderr']),
  }),
});

function unauthorized(operation, reason) {
  const error = new Error(`${operation.agentId} is not authorized to ${operation.action}: ${reason}`);
  error.code = 'AGENT_OPERATION_NOT_AUTHORIZED';
  throw error;
}

function authorizeEnvelope(input, operation) {
  const envelope = parseAgentEnvelope(input);
  if (envelope.task_id !== operation.taskId) unauthorized(operation, `task must be ${operation.taskId}`);
  if (envelope.agent_id !== operation.agentId) unauthorized(operation, `agent must be ${operation.agentId}`);
  if (envelope.capability_id !== operation.capabilityId) {
    unauthorized(operation, `capability must be ${operation.capabilityId}`);
  }
  if (!envelope.allowed_actions.includes(operation.action)) unauthorized(operation, `missing ${operation.action} permission`);
  if (!envelope.required_inputs.includes('repository_root')) unauthorized(operation, 'repository_root is not declared');
  if (envelope.error_state !== null) unauthorized(operation, 'error_state must be clear before execution');
  const schemaKeys = Object.keys(envelope.expected_output_schema).sort();
  if (schemaKeys.length !== 2 || schemaKeys[0] !== 'required' || schemaKeys[1] !== 'type'
    || envelope.expected_output_schema.type !== 'object'
    || !Array.isArray(envelope.expected_output_schema.required)
    || envelope.expected_output_schema.required.length !== operation.outputFields.length
    || operation.outputFields.some((field, index) => envelope.expected_output_schema.required[index] !== field)) {
    unauthorized(operation, 'expected_output_schema does not cover the executor result');
  }
  const requester = envelope.provenance.requested_by;
  if (requester === 'miss-vale-prime') {
    if (!envelope.mission_id.startsWith('mission-')
      || !Number.isSafeInteger(envelope.state_version)
      || envelope.state_version < operation.missionStateVersion
      || envelope.operation_id !== `${envelope.mission_id}-${operation.operationSuffix}`) {
      unauthorized(operation, 'mission context does not match the operational workflow stage');
    }
  } else if (requester === 'evaluation-harness' && operation === OPERATIONS.test) {
    if (!envelope.mission_id.startsWith('evaluation-')
      || envelope.state_version < 1
      || !/^control-[a-f0-9]{32}$/.test(envelope.operation_id)) {
      unauthorized(operation, 'mission context does not match a measured-control trial');
    }
  } else {
    unauthorized(operation, 'mission context has an unauthorized requester');
  }
  return envelope;
}

function canonicalTestFiles(testFiles) {
  const args = testArguments(testFiles);
  return args.length === 1 ? null : args.slice(1);
}

export function nodeExecutionInputBinding({ repositoryRoot, operation, testFiles } = {}) {
  const root = requireRepositoryRoot(repositoryRoot);
  if (operation !== 'inspect' && operation !== 'test') throw new TypeError('operation must be inspect or test');
  const payload = operation === 'inspect'
    ? { operation, repositoryRoot: root }
    : { operation, repositoryRoot: root, testFiles: canonicalTestFiles(testFiles) };
  const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return `node_execution_input_sha256:${digest}`;
}

function requireInputBinding(envelope, binding, operation) {
  if (envelope.required_inputs.length !== 2 || envelope.required_inputs[1] !== binding) {
    unauthorized(operation, 'input binding does not match repository_root and test selection');
  }
}

function boundedIntegerBudget(envelope, key, maximum) {
  const value = envelope.resource_budget[key];
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    unauthorized(OPERATIONS.test, `${key} must be an integer from 1 through ${maximum}`);
  }
  return value;
}

async function withinTimeout(timeout, operation) {
  const controller = new AbortController();
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const error = new Error(`operation timed out after ${timeout}ms`);
      error.code = 'OPERATION_TIMEOUT';
      reject(error);
    }, timeout);
  });
  try {
    return await Promise.race([operation(controller.signal), expired]);
  } finally {
    clearTimeout(timer);
  }
}

function requireRepositoryRoot(repositoryRoot) {
  if (typeof repositoryRoot !== 'string' || repositoryRoot.trim().length === 0) {
    throw new TypeError('repositoryRoot is required');
  }
  const trimmed = repositoryRoot.trim();
  // Remote dispatch may pass a POSIX absolute path for another host. Resolving
  // that on Windows would rewrite it (e.g. C:\home\...) and break the input
  // binding the worker recomputes on Linux.
  if (trimmed.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return trimmed.replace(/\/+$/, '') || '/';
  }
  return path.resolve(trimmed);
}

function text(value) {
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return typeof value === 'string' ? value : '';
}

function parseSummary(stdout) {
  const marker = '[ \\t]*(?:#|ℹ)[ \\t]*';
  const line = '\\r?\\n';
  const footer = new RegExp(
    `(?:^|${line})${marker}tests[ \\t]+(\\d+)[ \\t]*${line}`
    + `${marker}suites[ \\t]+(\\d+)[ \\t]*${line}`
    + `${marker}pass[ \\t]+(\\d+)[ \\t]*${line}`
    + `${marker}fail[ \\t]+(\\d+)[ \\t]*${line}`
    + `${marker}cancelled[ \\t]+(\\d+)[ \\t]*${line}`
    + `${marker}skipped[ \\t]+(\\d+)[ \\t]*${line}`
    + `${marker}todo[ \\t]+(\\d+)[ \\t]*${line}`
    + `${marker}duration_ms[ \\t]+(\\d+(?:\\.\\d+)?)[ \\t]*`,
    'gi',
  );
  const candidates = [...stdout.matchAll(footer)];
  if (candidates.length === 0) throw new Error('missing test summary: complete terminal footer');
  if (candidates.length !== 1) throw new Error('ambiguous test summary');
  const candidate = candidates[0];
  const end = candidate.index + candidate[0].length;
  if (!/^\s*$/.test(stdout.slice(end))) throw new Error('test summary must be terminal');

  const [, testsText, , passedText, failedText, cancelledText, skippedText, todoText] = candidate;
  const tests = Number.parseInt(testsText, 10);
  const passed = Number.parseInt(passedText, 10);
  const failed = Number.parseInt(failedText, 10);
  const cancelled = Number.parseInt(cancelledText, 10);
  const skipped = Number.parseInt(skippedText, 10);
  const todo = Number.parseInt(todoText, 10);
  if (tests !== passed + failed + skipped + cancelled + todo) {
    throw new Error('inconsistent test summary');
  }
  return { tests, passed, failed, skipped };
}

const CODE_FILE = /\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/i;
const TEST_FILE = /\.(?:test|spec)\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/i;

async function countFiles(directory, include, budget, signal, readdirImpl, relativePath = '') {
  signal.throwIfAborted();
  let entries;
  try {
    entries = await readdirImpl(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  signal.throwIfAborted();

  let count = 0;
  for (const entry of entries) {
    signal.throwIfAborted();
    budget.remaining -= 1;
    if (budget.remaining < 0) throw new Error('repository inspection exceeded max_filesystem_entries');
    const entryPath = path.join(directory, entry.name);
    const relativeEntryPath = path.join(relativePath, entry.name);
    if (entry.isDirectory()) count += await countFiles(entryPath, include, budget, signal, readdirImpl, relativeEntryPath);
    else if (entry.isFile() && include(relativeEntryPath)) count += 1;
  }
  return count;
}

function exitCodeFrom(error) {
  if (Number.isSafeInteger(error?.code)) return error.code;
  return 1;
}

/**
 * Mission regression must stay hermetic. The remote worker inherits mesh Redis
 * credentials for the queue; if those leak into `node --test`, live bus tests
 * run mid-mission and can emit post-footer noise that fails "summary must be
 * terminal" even when totals are green.
 */
export function sanitizeTestProcessEnv(env = process.env) {
  if (!env || typeof env !== 'object') throw new TypeError('env is required');
  const next = { ...env };
  for (const key of Object.keys(next)) {
    if (key.startsWith('ATHERE_MESH_') || key === 'DATABASE_URL') {
      delete next[key];
    }
  }
  return next;
}

function testArguments(testFiles) {
  if (testFiles === undefined) return ['--test'];
  if (!Array.isArray(testFiles) || testFiles.length === 0) throw new TypeError('testFiles must be a non-empty array');
  const files = testFiles.map((file) => {
    if (typeof file !== 'string' || file.length === 0 || path.isAbsolute(file)) throw new TypeError('test file must be relative');
    const normalized = file.replaceAll('\\', '/');
    if (!normalized.startsWith('tests/') || normalized.split('/').includes('..') || !TEST_FILE.test(normalized)) {
      throw new Error(`unsafe test file: ${file}`);
    }
    return normalized;
  });
  return ['--test', ...files];
}

export function createNodeTestExecutor({
  repositoryRoot,
  execFileImpl = defaultExecFile,
  readFileImpl = readFile,
  readdirImpl = readdir,
} = {}) {
  const root = requireRepositoryRoot(repositoryRoot);
  if (typeof execFileImpl !== 'function') throw new TypeError('execFileImpl must be a function');
  if (typeof readFileImpl !== 'function') throw new TypeError('readFileImpl must be a function');
  if (typeof readdirImpl !== 'function') throw new TypeError('readdirImpl must be a function');

  return Object.freeze({
    async inspect({ envelope: rawEnvelope } = {}) {
      const envelope = authorizeEnvelope(rawEnvelope, OPERATIONS.inspect);
      const maxEntries = envelope.resource_budget.max_filesystem_entries;
      if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0 || maxEntries > 1_000_000) {
        unauthorized(OPERATIONS.inspect, 'max_filesystem_entries must be an integer from 1 through 1000000');
      }
      requireInputBinding(envelope, nodeExecutionInputBinding({ repositoryRoot: root, operation: 'inspect' }), OPERATIONS.inspect);
      return withinTimeout(envelope.timeout, async (signal) => {
        const budget = { remaining: maxEntries };
        const packageJson = JSON.parse(await readFileImpl(path.join(root, 'package.json'), { encoding: 'utf8', signal }));
        return Object.freeze({
          package: Object.freeze({ name: packageJson.name, version: packageJson.version }),
          sourceFilesOnDisk: await countFiles(path.join(root, 'packages'), (relativePath) => {
            return relativePath.split(path.sep).includes('src') && CODE_FILE.test(relativePath);
          }, budget, signal, readdirImpl),
          testFilesOnDisk: await countFiles(path.join(root, 'tests'), (relativePath) => TEST_FILE.test(relativePath), budget, signal, readdirImpl),
        });
      });
    },

    async runTests({ envelope: rawEnvelope, testFiles } = {}) {
      const envelope = authorizeEnvelope(rawEnvelope, OPERATIONS.test);
      const maxProcesses = boundedIntegerBudget(envelope, 'max_processes', 1);
      if (maxProcesses !== 1) unauthorized(OPERATIONS.test, 'max_processes must permit exactly one process');
      const maxBuffer = boundedIntegerBudget(envelope, 'max_output_bytes', MAX_OUTPUT_BYTES);
      const args = testArguments(testFiles);
      requireInputBinding(
        envelope,
        nodeExecutionInputBinding({ repositoryRoot: root, operation: 'test', testFiles }),
        OPERATIONS.test,
      );
      const options = {
        cwd: root,
        shell: false,
        env: sanitizeTestProcessEnv(process.env),
        timeout: Math.min(envelope.timeout, DEFAULT_TIMEOUT_MS),
        maxBuffer,
        windowsHide: true,
      };
      let processResult;
      let exitCode = 0;
      try {
        processResult = await execFileImpl(process.execPath, args, options);
      } catch (error) {
        processResult = error;
        exitCode = exitCodeFrom(error);
      }
      const stdout = text(processResult?.stdout);
      const stderr = text(processResult?.stderr);
      const totals = parseSummary(stdout);
      return Object.freeze({
        command: `node ${args.join(' ')}`,
        exitCode,
        ...totals,
        stdout,
        stderr,
      });
    },
  });
}
