import os from 'node:os';
import { createNodeTestExecutor } from './node-test-executor.js';
import { DEFAULT_LEASE_MS } from './remote-work-queue.js';

function identityFrom(overrides = {}) {
  return {
    hostname: overrides.hostname ?? os.hostname(),
    platform: overrides.platform ?? `${os.platform()} ${os.release()}`,
    nodeVersion: overrides.nodeVersion ?? process.version,
    pid: overrides.pid ?? process.pid,
  };
}

async function withHeartbeat({ workQueue, jobId, workerId, leaseMs, run }) {
  if (typeof workQueue.heartbeat !== 'function') {
    return run();
  }
  const intervalMs = Math.max(250, Math.floor(leaseMs / 3));
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    workQueue.heartbeat({ jobId, workerId, leaseMs }).catch(() => {
      // Heartbeat failure is non-fatal here: reclaim will surface if the lease
      // truly expires. Swallow so a transient Redis blip does not abort work.
    });
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  try {
    return await run();
  } finally {
    stopped = true;
    clearInterval(timer);
  }
}

/**
 * Claim one remote job, run it with the existing node-test-executor (or a
 * provided executor), and publish the result back onto the work queue.
 * Returns null when no job was available within claimTimeoutMs.
 *
 * Supported kinds: inspect-repository, run-node-tests.
 * Claims use a lease; heartbeats keep the lease alive during long work so a
 * second worker can reclaim only after genuine expiry.
 */
export async function runRemoteExecutorWorkerOnce({
  workQueue,
  workerId = `worker-${os.hostname()}`,
  executor,
  identity,
  claimTimeoutMs = 5_000,
  leaseMs = DEFAULT_LEASE_MS,
  createExecutor = createNodeTestExecutor,
} = {}) {
  if (!workQueue || typeof workQueue.claim !== 'function' || typeof workQueue.complete !== 'function') {
    throw new TypeError('workQueue must provide claim and complete');
  }

  const job = await workQueue.claim({ workerId, timeoutMs: claimTimeoutMs, leaseMs });
  if (job === null) {
    return Object.freeze({ ok: false, reason: 'no-job', workerId });
  }

  const worker = identityFrom(identity);
  const startedAt = new Date().toISOString();
  let completion;

  try {
    const activeExecutor = executor ?? createExecutor({ repositoryRoot: job.repositoryRoot });
    const result = await withHeartbeat({
      workQueue,
      jobId: job.id,
      workerId,
      leaseMs,
      run: async () => {
        if (job.kind === 'run-node-tests') {
          if (typeof activeExecutor.runTests !== 'function') {
            throw new TypeError('executor must provide runTests');
          }
          return activeExecutor.runTests({
            envelope: job.envelope,
            ...(job.testFiles === undefined ? {} : { testFiles: job.testFiles }),
          });
        }
        if (job.kind === 'inspect-repository') {
          if (typeof activeExecutor.inspect !== 'function') {
            throw new TypeError('executor must provide inspect');
          }
          return activeExecutor.inspect({ envelope: job.envelope });
        }
        throw new Error(`unsupported job kind: ${job.kind}`);
      },
    });
    completion = {
      jobId: job.id,
      ok: true,
      worker,
      result,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    completion = {
      jobId: job.id,
      ok: false,
      worker,
      error: error instanceof Error ? error.message : String(error),
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  await workQueue.complete(completion);
  return Object.freeze({
    ok: completion.ok,
    jobId: job.id,
    missionId: job.missionId,
    kind: job.kind,
    worker,
    error: completion.error,
    result: completion.result,
  });
}

/**
 * Poll forever (or until abortSignal fires), processing one job at a time.
 */
export async function runRemoteExecutorWorkerLoop({
  workQueue,
  workerId,
  executor,
  identity,
  claimTimeoutMs = 5_000,
  leaseMs = DEFAULT_LEASE_MS,
  createExecutor,
  abortSignal,
  onReport,
} = {}) {
  const reports = [];
  while (abortSignal?.aborted !== true) {
    const report = await runRemoteExecutorWorkerOnce({
      workQueue,
      workerId,
      executor,
      identity,
      claimTimeoutMs,
      leaseMs,
      createExecutor,
    });
    if (typeof onReport === 'function') onReport(report);
    if (report.reason !== 'no-job') reports.push(report);
  }
  return Object.freeze({ reports: Object.freeze(reports) });
}
