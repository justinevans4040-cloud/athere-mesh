import os from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  createRedisRemoteWorkQueue,
  newJobId,
  resolveRemoteWorkQueueOptions,
} from '../packages/execution/src/remote-work-queue.js';
import { runRemoteExecutorWorkerOnce } from '../packages/execution/src/remote-executor-worker.js';
import { createNodeTestExecutor, nodeExecutionInputBinding } from '../packages/execution/src/node-test-executor.js';

// Cross-host remote executor dispatch smoke.
//
//   node scripts/smoke-remote-executor-dispatch.js dispatch --job <id> --mission <id>
//   node scripts/smoke-remote-executor-dispatch.js worker-once [--stub]
//   node scripts/smoke-remote-executor-dispatch.js await --job <id>
//
// Connection details come from ATHERE_MESH_REDIS_* only. Prints one JSON object.

const USAGE = 'usage: node scripts/smoke-remote-executor-dispatch.js <dispatch|worker-once|await> [--job id] [--mission id] [--repository-root path] [--test-file path] [--stub] [--await-ms n]';

function parseArgs(argv) {
  const mode = argv[0];
  if (mode !== 'dispatch' && mode !== 'worker-once' && mode !== 'await') throw new Error(USAGE);
  const flags = {};
  for (let index = 1; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--stub') {
      flags.stub = true;
      continue;
    }
    if (!name.startsWith('--')) throw new Error(USAGE);
    flags[name.slice(2)] = argv[index + 1];
    index += 1;
  }
  return { mode, flags };
}

function tailnetAddresses() {
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, addresses]) => (addresses ?? []).map((address) => ({ name, ...address })))
    .filter((address) => address.family === 'IPv4' && Number(address.address.split('.')[1]) >= 64
      && Number(address.address.split('.')[1]) <= 127 && address.address.startsWith('100.'))
    .map((address) => ({ interface: address.name, address: address.address }));
}

function identity() {
  return {
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    nodeVersion: process.version,
    tailnet: tailnetAddresses(),
    pid: process.pid,
  };
}

function smokeEnvelope({ missionId, repositoryRoot, testFiles }) {
  const binding = nodeExecutionInputBinding({
    repositoryRoot,
    operation: 'test',
    testFiles,
  });
  return {
    mission_id: missionId,
    task_id: 'run-node-tests',
    operation_id: `${missionId}-test-execution`,
    agent_id: 'rune',
    capability_id: 'node-test-runner',
    state_version: 3,
    objective: 'Execute the Node test suite for remote dispatch smoke',
    allowed_actions: ['execute_node_tests'],
    required_inputs: ['repository_root', binding],
    evidence_requirements: ['executor identity', 'operation result', 'mission state version'],
    timeout: 120_000,
    resource_budget: { max_processes: 1, max_output_bytes: 1_048_576 },
    expected_output_schema: {
      type: 'object',
      required: ['command', 'exitCode', 'tests', 'passed', 'failed', 'skipped', 'stdout', 'stderr'],
    },
    completion_conditions: ['executor returns the declared result schema without an error state'],
    error_state: null,
    provenance: { requested_by: 'miss-vale-prime', created_at: new Date().toISOString() },
  };
}

const { mode, flags } = parseArgs(process.argv.slice(2));
const options = resolveRemoteWorkQueueOptions(process.env);
if (options === null) {
  throw new Error('ATHERE_MESH_REDIS_URL or ATHERE_MESH_REDIS_HOST must be set, together with ATHERE_MESH_REDIS_SEED_ID');
}

// Prefer an explicit namespace from the environment so dispatch and worker share
// one queue. Falling back to the default keeps ad-hoc local probes simple.
const namespace = typeof process.env.ATHERE_MESH_WORK_NAMESPACE === 'string'
  && process.env.ATHERE_MESH_WORK_NAMESPACE.trim().length > 0
  ? process.env.ATHERE_MESH_WORK_NAMESPACE.trim()
  : options.namespace;

const queue = createRedisRemoteWorkQueue({ ...options, namespace });
const startedAt = new Date().toISOString();
const report = {
  ok: false,
  smoke: 'remote-executor-dispatch',
  mode,
  process: identity(),
  seed: {
    host: options.host,
    port: options.port,
    seedKey: options.seedKey,
    expectedSeedId: options.expectedSeedId,
    workNamespace: namespace,
  },
  startedAt,
  finishedAt: null,
};

try {
  if (mode === 'dispatch') {
    const missionId = flags.mission ?? `mission-remote-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const jobId = flags.job ?? newJobId();
    const repositoryRoot = flags['repository-root'] ?? process.cwd();
    const testFiles = flags['test-file'] ? [flags['test-file']] : undefined;
    const job = {
      id: jobId,
      kind: 'run-node-tests',
      missionId,
      repositoryRoot,
      envelope: smokeEnvelope({ missionId, repositoryRoot, testFiles }),
      ...(testFiles === undefined ? {} : { testFiles }),
      dispatchedAt: startedAt,
      dispatcherHost: os.hostname(),
    };
    report.job = {
      id: job.id,
      kind: job.kind,
      missionId: job.missionId,
      repositoryRoot: job.repositoryRoot,
      testFiles: job.testFiles ?? null,
      dispatcherHost: job.dispatcherHost,
    };
    report.enqueued = await queue.enqueue(job);
    const awaitMs = Number(flags['await-ms'] ?? 0);
    if (awaitMs > 0) {
      report.result = await queue.awaitResult(jobId, { timeoutMs: awaitMs, pollMs: 200 });
      report.ok = report.result?.ok === true;
    } else {
      report.ok = report.enqueued?.accepted === true;
    }
  } else if (mode === 'await') {
    if (!flags.job) throw new Error('--job is required for await');
    report.result = await queue.awaitResult(flags.job, {
      timeoutMs: Number(flags['await-ms'] ?? 120_000),
      pollMs: 200,
    });
    report.ok = report.result?.ok === true;
  } else {
    const stub = flags.stub === true;
    report.worker = await runRemoteExecutorWorkerOnce({
      workQueue: queue,
      workerId: `smoke-${os.hostname()}`,
      identity: identity(),
      claimTimeoutMs: Number(flags['await-ms'] ?? 30_000),
      ...(stub
        ? {
          executor: {
            async runTests() {
              return {
                command: 'node --test (stub)',
                exitCode: 0,
                tests: 1,
                passed: 1,
                failed: 0,
                skipped: 0,
                stdout: 'ℹ tests 1\nℹ suites 1\nℹ pass 1\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ duration_ms 1.0\n',
                stderr: '',
              };
            },
          },
        }
        : {
          createExecutor: createNodeTestExecutor,
        }),
    });
    report.ok = report.worker?.ok === true;
  }
} finally {
  report.finishedAt = new Date().toISOString();
  await queue.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.ok !== true) process.exitCode = 1;
