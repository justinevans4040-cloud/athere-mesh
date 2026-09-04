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

/**
 * Executor facade: inspect stays on the local host; run-node-tests is enqueued
 * for a remote worker and awaited. The orchestrator keeps calling the same
 * inspect/runTests surface — only the runTests path crosses the mesh.
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
  const local = requireLocal(localExecutor);
  const queue = requireQueue(workQueue);
  if (typeof workerRepositoryRoot !== 'string' || workerRepositoryRoot.trim().length === 0) {
    throw new TypeError('workerRepositoryRoot is required');
  }

  return Object.freeze({
    async inspect(input) {
      return local.inspect(input);
    },

    async runTests({ envelope, testFiles } = {}) {
      if (!envelope || typeof envelope !== 'object') throw new TypeError('envelope is required for remote dispatch');
      const jobId = idFactory();
      const missionId = typeof envelope.mission_id === 'string' && envelope.mission_id.length > 0
        ? envelope.mission_id
        : `mission-${randomUUID().replace(/-/g, '').slice(0, 12)}`;

      const job = {
        id: jobId,
        kind: 'run-node-tests',
        missionId,
        repositoryRoot: workerRepositoryRoot,
        envelope,
        ...(testFiles === undefined ? {} : { testFiles }),
        dispatchedAt: new Date().toISOString(),
        dispatcherHost,
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
      } = completion.result;
      return Object.freeze({
        command,
        exitCode,
        tests,
        passed,
        failed,
        skipped,
        stdout,
        stderr,
      });
    },
  });
}
