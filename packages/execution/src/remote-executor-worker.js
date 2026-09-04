import os from 'node:os';
import { createNodeTestExecutor } from './node-test-executor.js';

function identityFrom(overrides = {}) {
  return {
    hostname: overrides.hostname ?? os.hostname(),
    platform: overrides.platform ?? `${os.platform()} ${os.release()}`,
    nodeVersion: overrides.nodeVersion ?? process.version,
    pid: overrides.pid ?? process.pid,
  };
}

/**
 * Claim one remote job, run it with the existing node-test-executor (or a
 * provided executor), and publish the result back onto the work queue.
 * Returns null when no job was available within claimTimeoutMs.
 */
export async function runRemoteExecutorWorkerOnce({
  workQueue,
  workerId = `worker-${os.hostname()}`,
  executor,
  identity,
  claimTimeoutMs = 5_000,
  createExecutor = createNodeTestExecutor,
} = {}) {
  if (!workQueue || typeof workQueue.claim !== 'function' || typeof workQueue.complete !== 'function') {
    throw new TypeError('workQueue must provide claim and complete');
  }

  const job = await workQueue.claim({ workerId, timeoutMs: claimTimeoutMs });
  if (job === null) {
    return Object.freeze({ ok: false, reason: 'no-job', workerId });
  }

  const worker = identityFrom(identity);
  const startedAt = new Date().toISOString();
  let completion;

  try {
    const activeExecutor = executor ?? createExecutor({ repositoryRoot: job.repositoryRoot });
    if (job.kind !== 'run-node-tests') {
      throw new Error(`unsupported job kind: ${job.kind}`);
    }
    if (typeof activeExecutor.runTests !== 'function') {
      throw new TypeError('executor must provide runTests');
    }
    const result = await activeExecutor.runTests({
      envelope: job.envelope,
      ...(job.testFiles === undefined ? {} : { testFiles: job.testFiles }),
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
      createExecutor,
    });
    if (typeof onReport === 'function') onReport(report);
    if (report.reason !== 'no-job') reports.push(report);
  }
  return Object.freeze({ reports: Object.freeze(reports) });
}
