#!/usr/bin/env node
import os from 'node:os';
import { runRemoteExecutorWorkerOnce, runRemoteExecutorWorkerLoop } from '../packages/execution/src/remote-executor-worker.js';
import {
  createRedisRemoteWorkQueue,
  resolveRemoteWorkQueueOptions,
} from '../packages/execution/src/remote-work-queue.js';

// Long-running (or one-shot) remote executor worker for Ichabod / mesh hosts.
//
//   node scripts/remote-executor-worker.js --once
//   node scripts/remote-executor-worker.js --loop
//
// Requires ATHERE_MESH_REDIS_* and a repository checkout at the job's
// repositoryRoot (set by the dispatcher).

const args = new Set(process.argv.slice(2));
const once = args.has('--once') || !args.has('--loop');
const options = resolveRemoteWorkQueueOptions(process.env);
if (options === null) {
  throw new Error('ATHERE_MESH_REDIS_URL or ATHERE_MESH_REDIS_HOST must be set, together with ATHERE_MESH_REDIS_SEED_ID');
}

const namespace = typeof process.env.ATHERE_MESH_WORK_NAMESPACE === 'string'
  && process.env.ATHERE_MESH_WORK_NAMESPACE.trim().length > 0
  ? process.env.ATHERE_MESH_WORK_NAMESPACE.trim()
  : options.namespace;

const queue = createRedisRemoteWorkQueue({ ...options, namespace });
const workerId = process.env.ATHERE_MESH_WORKER_ID ?? `worker-${os.hostname()}`;

process.stderr.write(`remote-executor-worker start host=${os.hostname()} workerId=${workerId} namespace=${namespace} mode=${once ? 'once' : 'loop'}\n`);

try {
  if (once) {
    const report = await runRemoteExecutorWorkerOnce({
      workQueue: queue,
      workerId,
      claimTimeoutMs: Number(process.env.ATHERE_MESH_WORKER_CLAIM_MS ?? 30_000),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.ok !== true) process.exitCode = 1;
  } else {
    const abort = new AbortController();
    process.on('SIGINT', () => abort.abort());
    process.on('SIGTERM', () => abort.abort());
    await runRemoteExecutorWorkerLoop({
      workQueue: queue,
      workerId,
      claimTimeoutMs: Number(process.env.ATHERE_MESH_WORKER_CLAIM_MS ?? 5_000),
      abortSignal: abort.signal,
      onReport: (report) => {
        if (report.reason === 'no-job') return;
        process.stdout.write(`${JSON.stringify(report)}\n`);
      },
    });
  }
} finally {
  await queue.close();
}
