import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createRedisRemoteWorkQueue,
  resolveRemoteWorkQueueOptions,
} from '../packages/execution/src/remote-work-queue.js';
import { nodeExecutionInputBinding } from '../packages/execution/src/node-test-executor.js';

// Broader remote suite than the single pin: dispatch a fixed contract cohort
// to the standing worker namespace and await the result.
//
//   ATHERE_MESH_REDIS_* ... \
 // ATHERE_MESH_REMOTE_REPOSITORY_ROOT=/home/the_founder/athere-mesh \
 // node scripts/smoke-remote-executor-cohort.js

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Contract cohort: more than the single pin, still bounded and offline-safe.
export const REMOTE_EXECUTOR_COHORT = Object.freeze([
  'tests/contract/remote-executor-smoke-pin.test.js',
  'tests/contract/authority-chain.test.js',
  'tests/contract/execution-roles.test.js',
  'tests/contract/fleet-contract.test.js',
]);

const options = resolveRemoteWorkQueueOptions(process.env);
if (options === null) throw new Error('ATHERE_MESH_REDIS_* + seed required');

const remoteRoot = typeof process.env.ATHERE_MESH_REMOTE_REPOSITORY_ROOT === 'string'
  && process.env.ATHERE_MESH_REMOTE_REPOSITORY_ROOT.trim().length > 0
  ? process.env.ATHERE_MESH_REMOTE_REPOSITORY_ROOT.trim()
  : null;
if (remoteRoot === null) throw new Error('ATHERE_MESH_REMOTE_REPOSITORY_ROOT is required');

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').slice(0, 15);
const namespace = typeof process.env.ATHERE_MESH_WORK_NAMESPACE === 'string'
  && process.env.ATHERE_MESH_WORK_NAMESPACE.trim().length > 0
  ? process.env.ATHERE_MESH_WORK_NAMESPACE.trim()
  : options.namespace;

const queue = createRedisRemoteWorkQueue({ ...options, namespace });
const missionId = `mission-cohort-${stamp}`;
const jobId = `job-cohort-${stamp}`;
const binding = nodeExecutionInputBinding({
  repositoryRoot: remoteRoot,
  operation: 'test',
  testFiles: [...REMOTE_EXECUTOR_COHORT],
});

const job = {
  id: jobId,
  kind: 'run-node-tests',
  missionId,
  repositoryRoot: remoteRoot,
  testFiles: [...REMOTE_EXECUTOR_COHORT],
  envelope: {
    mission_id: missionId,
    task_id: 'run-node-tests',
    operation_id: `${missionId}-test-execution`,
    agent_id: 'rune',
    capability_id: 'node-test-runner',
    state_version: 3,
    objective: 'Execute the remote executor contract cohort',
    allowed_actions: ['execute_node_tests'],
    required_inputs: ['repository_root', binding],
    evidence_requirements: ['executor identity', 'operation result', 'mission state version'],
    timeout: 180_000,
    resource_budget: { max_processes: 1, max_output_bytes: 1_048_576 },
    expected_output_schema: {
      type: 'object',
      required: ['command', 'exitCode', 'tests', 'passed', 'failed', 'skipped', 'stdout', 'stderr'],
    },
    completion_conditions: ['executor returns the declared result schema without an error state'],
    error_state: null,
    provenance: { requested_by: 'miss-vale-prime', created_at: new Date().toISOString() },
  },
  dispatchedAt: new Date().toISOString(),
  dispatcherHost: os.hostname(),
};

const report = {
  ok: false,
  smoke: 'remote-executor-cohort-crosshost',
  claim: 'Standing Ichabod worker runs a multi-file contract cohort (not pin-only) dispatched from Lenovo over mesh Redis with zero mid-flight SSH claim.',
  at: new Date().toISOString(),
  workNamespace: namespace,
  cohort: REMOTE_EXECUTOR_COHORT,
  remoteRepositoryRoot: remoteRoot,
  midFlightSshClaim: false,
  dispatcher: { hostname: os.hostname(), pid: process.pid, node: process.version },
};

try {
  const enqueued = await queue.enqueue(job);
  report.enqueued = enqueued;
  const result = await queue.awaitResult(jobId, { timeoutMs: 180_000, pollMs: 250 });
  report.result = result;
  report.ok = result.ok === true
    && result.worker?.hostname === 'ichabodcrane'
    && Number(result.result?.passed) >= REMOTE_EXECUTOR_COHORT.length
    && Number(result.result?.failed) === 0;
  if (!report.ok && report.error === undefined) {
    report.error = 'cohort result did not meet pass criteria';
  }
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  await queue.close();
}

const outDir = path.join(repoRoot, 'evidence');
await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, `smoke-remote-executor-cohort-crosshost-${stamp}.json`);
await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ ok: report.ok, evidence: outPath, error: report.error ?? null }, null, 2)}\n`);
process.exitCode = report.ok ? 0 : 1;
