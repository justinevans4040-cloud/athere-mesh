import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { newJobId } from './remote-work-queue.js';

function requireQueue(workQueue) {
  if (!workQueue
    || typeof workQueue.enqueue !== 'function'
    || typeof workQueue.awaitResult !== 'function') {
    throw new TypeError('workQueue must provide enqueue and awaitResult');
  }
  return workQueue;
}

function requireLocal(localExecutor) {
  if (!localExecutor
    || typeof localExecutor.inspect !== 'function'
    || typeof localExecutor.runTests !== 'function') {
    throw new TypeError('localExecutor must provide inspect and runTests');
  }
  return localExecutor;
}

function stripRemoteMeta(result) {
  return result;
}

/**
 * Executor facade: both inspect and run-node-tests are enqueued for a remote
 * worker and awaited. The local executor is retained only as a type/shape
 * guard for offline hermetic construction — it is not called on the dispatch
 * path when a work queue is injected.
 */
export function createRemoteDispatchExecutor({
  localExecutor,
  workQueue,
  workerRepositoryRoot,
  awaitTimeoutMs = 300_000,
  pollMs = 200,
  dispatcherHost = os.hostname(),
  idFactory = newJobId,
} = {}) {
  // localExecutor is required so callers cannot accidentally inject a half-built
  // facade, but both inspect and runTests cross the mesh when queued.
  requireLocal(localExecutor);
  const queue = requireQueue(workQueue);
  if (typeof workerRepositoryRoot !== 'string' || workerRepositoryRoot.trim().length === 0) {
    throw new TypeError('workerRepositoryRoot is required');
  }

  async function dispatch({ kind, envelope, testFiles, taskId }) {
    if (!envelope || typeof envelope !== 'object') throw new TypeError('envelope is required for remote dispatch');
    const jobId = idFactory();
    const missionId = typeof envelope.mission_id === 'string' && envelope.mission_id.length > 0
      ? envelope.mission_id
      : `mission-${randomUUID().replace(/-/g, '').slice(0, 12)}`;

    const job = {
      id: jobId,
      kind,
      missionId,
      repositoryRoot: workerRepositoryRoot,
      envelope,
      ...(testFiles === undefined ? {} : { testFiles }),
      dispatchedAt: new Date().toISOString(),
      dispatcherHost,
      ...(taskId === undefined ? {} : { taskId }),
    };

    const enqueued = await queue.enqueue(job);
    if (enqueued.accepted !== true) throw new Error(`remote dispatch enqueue rejected for ${jobId}`);

    const completion = await queue.awaitResult(jobId, { timeoutMs: awaitTimeoutMs, pollMs });
    if (completion.ok !== true) {
      throw new Error(completion.error ?? `remote worker failed job ${jobId}`);
    }
    if (!completion.result || typeof completion.result !== 'object') {
      throw new Error(`remote worker returned no result for ${jobId}`);
    }
    return completion.result;
  }

  return Object.freeze({
    async inspect({ envelope } = {}) {
      const result = await dispatch({
        kind: 'inspect-repository',
        envelope,
        taskId: 'inspect-repository',
      });
      // parseRepositoryInspectionResult requires an exact key set.
      const { package: pkg, sourceFilesOnDisk, testFilesOnDisk } = result;
      return stripRemoteMeta(Object.freeze({
        package: pkg,
        sourceFilesOnDisk,
        testFilesOnDisk,
      }));
    },

    async runTests({ envelope, testFiles } = {}) {
      const result = await dispatch({
        kind: 'run-node-tests',
        envelope,
        testFiles,
        taskId: 'run-node-tests',
      });
      // parseNodeTestExecutionResult requires an exact key set. Remote metadata
      // lives on the work-queue result record / smoke evidence, not on this
      // surface, so the orchestrator path stays schema-compatible.
      const {
        command,
        exitCode,
        tests,
        passed,
        failed,
        skipped,
        stdout,
        stderr,
      } = result;
      return stripRemoteMeta(Object.freeze({
        command,
        exitCode,
        tests,
        passed,
        failed,
        skipped,
        stdout,
        stderr,
      }));
    },
  });
}
