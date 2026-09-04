import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  createMemoryRemoteWorkQueue,
  createRedisRemoteWorkQueue,
  resolveRemoteWorkQueueOptions,
} from '../../packages/execution/src/remote-work-queue.js';
import { createRemoteDispatchExecutor } from '../../packages/execution/src/remote-dispatch-executor.js';
import { runRemoteExecutorWorkerOnce } from '../../packages/execution/src/remote-executor-worker.js';
import { resolveRedisResonanceOptions } from '../../packages/resonance/src/redis-resonance-bus.js';
import { createRespClient } from '../../packages/resonance/src/resp-client.js';

function sampleJob(overrides = {}) {
  return {
    id: overrides.id ?? `job-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    kind: 'run-node-tests',
    missionId: overrides.missionId ?? `mission-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    repositoryRoot: overrides.repositoryRoot ?? '/tmp/athere-mesh',
    envelope: overrides.envelope ?? {
      mission_id: 'mission-demo',
      task_id: 'run-node-tests',
      operation_id: 'mission-demo-test-execution',
      agent_id: 'rune',
      capability_id: 'node-test-runner',
      state_version: 3,
      objective: 'Execute the complete Node test suite for the active mission',
      allowed_actions: ['execute_node_tests'],
      required_inputs: ['repository_root', 'node_execution_input_sha256:abc'],
      evidence_requirements: ['executor identity', 'operation result', 'mission state version'],
      timeout: 30_000,
      resource_budget: { max_processes: 1, max_output_bytes: 1_048_576 },
      expected_output_schema: {
        type: 'object',
        required: ['command', 'exitCode', 'tests', 'passed', 'failed', 'skipped', 'stdout', 'stderr'],
      },
      completion_conditions: ['executor returns the declared result schema without an error state'],
      error_state: null,
      provenance: { requested_by: 'miss-vale-prime', created_at: '2026-09-03T00:00:00.000Z' },
    },
    dispatchedAt: overrides.dispatchedAt ?? '2026-09-03T12:00:00.000Z',
    dispatcherHost: overrides.dispatcherHost ?? 'JustinLenovo',
    ...overrides,
  };
}

test('memory remote work queue enqueues, claims, and returns results', async () => {
  const queue = createMemoryRemoteWorkQueue();
  const job = sampleJob({ id: 'job-memory-1' });
  const enqueued = await queue.enqueue(job);
  assert.equal(enqueued.accepted, true);
  assert.equal(enqueued.duplicate, false);

  const claimed = await queue.claim({ workerId: 'worker-a' });
  assert.equal(claimed.id, 'job-memory-1');
  assert.equal(claimed.kind, 'run-node-tests');

  const empty = await queue.claim({ workerId: 'worker-a', timeoutMs: 10 });
  assert.equal(empty, null);

  await queue.complete({
    jobId: job.id,
    ok: true,
    worker: { hostname: 'ichabodcrane', pid: 1 },
    result: { command: 'node --test', exitCode: 0, tests: 1, passed: 1, failed: 0, skipped: 0, stdout: 'ok', stderr: '' },
    completedAt: '2026-09-03T12:00:01.000Z',
  });

  const waited = await queue.awaitResult(job.id, { timeoutMs: 1000, pollMs: 10 });
  assert.equal(waited.ok, true);
  assert.equal(waited.result.exitCode, 0);
  await queue.close();
});

test('memory remote work queue rejects conflicting job id reuse', async () => {
  const queue = createMemoryRemoteWorkQueue();
  const job = sampleJob({ id: 'job-conflict' });
  await queue.enqueue(job);
  await assert.rejects(
    () => queue.enqueue({ ...job, missionId: 'mission-other' }),
    /idempotency conflict/i,
  );
  await queue.close();
});

test('remote dispatch executor dispatches inspect and runTests (local never called)', async () => {
  const queue = createMemoryRemoteWorkQueue();
  let inspectCalls = 0;
  let runCalls = 0;
  const local = {
    async inspect() {
      inspectCalls += 1;
      throw new Error('local inspect must not be called when dispatching remotely');
    },
    async runTests() {
      runCalls += 1;
      throw new Error('local runTests must not be called when dispatching remotely');
    },
  };

  const jobIds = ['job-dispatch-inspect', 'job-dispatch-tests'];
  let idIndex = 0;
  const worker = (async () => {
    let completed = 0;
    while (completed < 2) {
      const job = await queue.claim({ workerId: 'test-worker', timeoutMs: 50 });
      if (job === null) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        continue;
      }
      const result = job.kind === 'inspect-repository'
        ? { package: { name: 'athere-mesh', version: '0.1.0' }, sourceFilesOnDisk: 1, testFilesOnDisk: 1 }
        : {
          command: 'node --test',
          exitCode: 0,
          tests: 2,
          passed: 2,
          failed: 0,
          skipped: 0,
          stdout: 'ok',
          stderr: '',
        };
      await queue.complete({
        jobId: job.id,
        ok: true,
        worker: { hostname: 'ichabodcrane', pid: 42 },
        result,
        completedAt: new Date().toISOString(),
      });
      completed += 1;
    }
  })();

  const remote = createRemoteDispatchExecutor({
    localExecutor: local,
    workQueue: queue,
    workerRepositoryRoot: '/remote/athere-mesh',
    awaitTimeoutMs: 5_000,
    dispatcherHost: 'JustinLenovo',
    idFactory: () => jobIds[idIndex++],
  });

  const inspection = await remote.inspect({ envelope: sampleJob({ kind: 'inspect-repository' }).envelope });
  assert.equal(inspectCalls, 0);
  assert.equal(inspection.package.name, 'athere-mesh');

  const tests = await remote.runTests({
    envelope: sampleJob().envelope,
  });
  assert.equal(runCalls, 0);
  assert.equal(tests.exitCode, 0);
  assert.equal(tests.passed, 2);
  // Exact-key schema: remote hostname is on the queue result, not the executor return.
  assert.equal(Object.hasOwn(tests, 'remoteWorker'), false);
  await worker;

  const meta = await queue.awaitResult('job-dispatch-tests', { timeoutMs: 1000, pollMs: 10 });
  assert.equal(meta.worker.hostname, 'ichabodcrane');
  await queue.close();
});

test('memory remote work queue reclaims an expired lease for a second worker', async () => {
  const queue = createMemoryRemoteWorkQueue({ defaultLeaseMs: 40 });
  const job = sampleJob({ id: 'job-lease-1' });
  await queue.enqueue(job);

  const first = await queue.claim({ workerId: 'worker-a', leaseMs: 40 });
  assert.equal(first.id, 'job-lease-1');
  assert.equal(first.claimedBy, 'worker-a');

  const blocked = await queue.claim({ workerId: 'worker-b', timeoutMs: 10 });
  assert.equal(blocked, null);

  await new Promise((resolve) => setTimeout(resolve, 60));
  const reclaimed = await queue.reclaimExpired();
  assert.equal(reclaimed.reclaimed, 1);

  const second = await queue.claim({ workerId: 'worker-b', leaseMs: 5_000 });
  assert.equal(second.id, 'job-lease-1');
  assert.equal(second.claimedBy, 'worker-b');

  await queue.complete({
    jobId: job.id,
    ok: true,
    worker: { hostname: 'ichabodcrane', pid: 2 },
    result: { command: 'node --test', exitCode: 0, tests: 1, passed: 1, failed: 0, skipped: 0, stdout: '', stderr: '' },
    completedAt: new Date().toISOString(),
  });
  await queue.close();
});

test('memory remote work queue heartbeat prevents reclaim by a second worker', async () => {
  const queue = createMemoryRemoteWorkQueue({ defaultLeaseMs: 80 });
  const job = sampleJob({ id: 'job-lease-hb' });
  await queue.enqueue(job);
  await queue.claim({ workerId: 'worker-a', leaseMs: 80 });

  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    await queue.heartbeat({ jobId: job.id, workerId: 'worker-a', leaseMs: 80 });
  }

  const reclaimed = await queue.reclaimExpired();
  assert.equal(reclaimed.reclaimed, 0);
  const blocked = await queue.claim({ workerId: 'worker-b', timeoutMs: 10 });
  assert.equal(blocked, null);

  await queue.complete({
    jobId: job.id,
    ok: true,
    worker: { hostname: 'ichabodcrane', pid: 3 },
    result: { command: 'node --test', exitCode: 0, tests: 1, passed: 1, failed: 0, skipped: 0, stdout: '', stderr: '' },
    completedAt: new Date().toISOString(),
  });
  await queue.close();
});

test('remote executor worker handles inspect-repository jobs', async () => {
  const queue = createMemoryRemoteWorkQueue();
  const job = sampleJob({
    id: 'job-inspect-once',
    kind: 'inspect-repository',
    repositoryRoot: '/does-not-matter',
  });
  await queue.enqueue(job);

  const report = await runRemoteExecutorWorkerOnce({
    workQueue: queue,
    workerId: 'worker-inspect',
    executor: {
      async inspect() {
        return { package: { name: 'athere-mesh', version: '0.1.0' }, sourceFilesOnDisk: 4, testFilesOnDisk: 7 };
      },
      async runTests() {
        throw new Error('runTests must not run for inspect jobs');
      },
    },
    identity: { hostname: 'ichabodcrane', pid: 88 },
    claimTimeoutMs: 100,
  });

  assert.equal(report.ok, true);
  assert.equal(report.kind, 'inspect-repository');
  const result = await queue.awaitResult('job-inspect-once', { timeoutMs: 1000, pollMs: 10 });
  assert.equal(result.result.sourceFilesOnDisk, 4);
  await queue.close();
});

test('remote executor worker runs the local executor once and publishes the result', async () => {
  const queue = createMemoryRemoteWorkQueue();
  const job = sampleJob({ id: 'job-worker-once', repositoryRoot: '/does-not-matter' });
  await queue.enqueue(job);

  const report = await runRemoteExecutorWorkerOnce({
    workQueue: queue,
    workerId: 'worker-once',
    executor: {
      async runTests() {
        return {
          command: 'node --test',
          exitCode: 0,
          tests: 3,
          passed: 3,
          failed: 0,
          skipped: 0,
          stdout: 'ok',
          stderr: '',
        };
      },
    },
    identity: { hostname: 'ichabodcrane', pid: 99 },
    claimTimeoutMs: 100,
  });

  assert.equal(report.ok, true);
  assert.equal(report.jobId, 'job-worker-once');
  const result = await queue.awaitResult('job-worker-once', { timeoutMs: 1000, pollMs: 10 });
  assert.equal(result.result.passed, 3);
  await queue.close();
});

// ---------------------------------------------------------------------------
// Live Redis cases — skip when mesh Redis is not configured / unreachable.
// ---------------------------------------------------------------------------

const configured = resolveRedisResonanceOptions(process.env);
const runNamespace = `athere:mesh:test:work:${randomUUID()}`;

async function probeSeed(candidate) {
  const client = createRespClient({
    host: candidate.host,
    port: candidate.port,
    password: candidate.password,
    connectTimeoutMs: 2000,
    commandTimeoutMs: 2000,
  });
  try {
    await client.connect();
    const seed = await client.command(['GET', candidate.seedKey]);
    if (seed !== candidate.expectedSeedId) return `seed mismatch: found ${seed === null ? '<missing>' : seed}`;
    return null;
  } catch (error) {
    return error.message;
  } finally {
    await client.close();
  }
}

const unavailableReason = configured === null
  ? 'ATHERE_MESH_REDIS_* not configured (offline default)'
  : await probeSeed(configured);
const skip = unavailableReason === null ? false : `mesh Redis seed unavailable — ${unavailableReason}`;

test('redis remote work queue options resolve from the shared mesh Redis env', { skip: false }, () => {
  assert.equal(resolveRemoteWorkQueueOptions({}), null);
  const resolved = resolveRemoteWorkQueueOptions({
    ATHERE_MESH_REDIS_HOST: '100.77.131.28',
    ATHERE_MESH_REDIS_PORT: '6380',
    ATHERE_MESH_REDIS_PASSWORD: 'secret',
    ATHERE_MESH_REDIS_SEED_ID: 'seed@host',
  });
  assert.equal(resolved.host, '100.77.131.28');
  assert.equal(resolved.port, 6380);
  assert.equal(resolved.expectedSeedId, 'seed@host');
  assert.match(resolved.namespace, /^athere:mesh:work/);
});

test('redis remote work queue round-trips a job through the mesh seed', { skip }, async () => {
  const queue = createRedisRemoteWorkQueue({ ...configured, namespace: runNamespace, connectTimeoutMs: 5000, commandTimeoutMs: 5000 });
  const job = sampleJob({ id: `job-live-${randomUUID().replace(/-/g, '').slice(0, 8)}` });
  try {
    const enqueued = await queue.enqueue(job);
    assert.equal(enqueued.accepted, true);
    const claimed = await queue.claim({ workerId: 'live-worker', timeoutMs: 2000 });
    assert.equal(claimed.id, job.id);
    await queue.complete({
      jobId: job.id,
      ok: true,
      worker: { hostname: 'test-host', pid: process.pid },
      result: { command: 'node --test', exitCode: 0, tests: 1, passed: 1, failed: 0, skipped: 0, stdout: '', stderr: '' },
      completedAt: new Date().toISOString(),
    });
    const result = await queue.awaitResult(job.id, { timeoutMs: 2000, pollMs: 50 });
    assert.equal(result.ok, true);
    assert.equal(result.jobId, job.id);
  } finally {
    await queue.close();
  }
});

test('redis remote work queue reclaims an expired lease across workers', { skip }, async () => {
  const namespace = `${runNamespace}:lease`;
  const queue = createRedisRemoteWorkQueue({
    ...configured,
    namespace,
    connectTimeoutMs: 5000,
    commandTimeoutMs: 5000,
    defaultLeaseMs: 200,
  });
  const job = sampleJob({ id: `job-lease-live-${randomUUID().replace(/-/g, '').slice(0, 8)}` });
  try {
    await queue.enqueue(job);
    const first = await queue.claim({ workerId: 'live-worker-a', timeoutMs: 2000, leaseMs: 200 });
    assert.equal(first.id, job.id);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const reclaimed = await queue.reclaimExpired();
    assert.ok(reclaimed.reclaimed >= 1);
    const second = await queue.claim({ workerId: 'live-worker-b', timeoutMs: 2000, leaseMs: 5_000 });
    assert.equal(second.id, job.id);
    assert.equal(second.claimedBy, 'live-worker-b');
    await queue.complete({
      jobId: job.id,
      ok: true,
      worker: { hostname: 'test-host', pid: process.pid },
      result: { command: 'node --test', exitCode: 0, tests: 1, passed: 1, failed: 0, skipped: 0, stdout: '', stderr: '' },
      completedAt: new Date().toISOString(),
    });
  } finally {
    await queue.close();
  }
});
