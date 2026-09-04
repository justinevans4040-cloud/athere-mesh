import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createRedisRemoteWorkQueue,
  resolveRemoteWorkQueueOptions,
} from '../packages/execution/src/remote-work-queue.js';

// Multi-worker lease reclaim smoke against mesh Redis (isolated namespace).
// Process A claims with a short lease and abandons; Process B (same host or
// another) reclaims after expiry. Does not use the standing worker queue.
//
//   ATHERE_MESH_REDIS_* ... node scripts/smoke-remote-work-lease.js

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = resolveRemoteWorkQueueOptions(process.env);
if (options === null) {
  throw new Error('ATHERE_MESH_REDIS_* + seed required');
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').slice(0, 15);
const namespace = `athere:mesh:work:lease-smoke:${stamp}`;
const queue = createRedisRemoteWorkQueue({
  ...options,
  namespace,
  defaultLeaseMs: 500,
  connectTimeoutMs: 5_000,
  commandTimeoutMs: 5_000,
});

const job = {
  id: `job-lease-${randomUUID().replace(/-/g, '').slice(0, 10)}`,
  kind: 'run-node-tests',
  missionId: `mission-lease-${stamp}`,
  repositoryRoot: '/tmp/athere-mesh-lease-smoke',
  envelope: {
    mission_id: `mission-lease-${stamp}`,
    task_id: 'run-node-tests',
    operation_id: `mission-lease-${stamp}-test`,
    agent_id: 'rune',
    capability_id: 'node-test-runner',
    state_version: 1,
    objective: 'lease reclaim smoke',
    allowed_actions: ['execute_node_tests'],
    required_inputs: ['repository_root'],
    evidence_requirements: ['executor identity'],
    timeout: 5_000,
    resource_budget: { max_processes: 1, max_output_bytes: 1024 },
    expected_output_schema: { type: 'object', required: ['exitCode'] },
    completion_conditions: ['done'],
    error_state: null,
    provenance: { requested_by: 'lease-smoke', created_at: new Date().toISOString() },
  },
  dispatchedAt: new Date().toISOString(),
  dispatcherHost: os.hostname(),
};

const report = {
  ok: false,
  smoke: 'remote-work-lease-reclaim',
  claim: 'Worker A claims with a short lease and abandons; after expiry, reclaim returns the job and Worker B claims it. Proves multi-worker lease beyond LPOP-only.',
  at: new Date().toISOString(),
  namespace,
  seedId: options.expectedSeedId,
  dispatcher: { hostname: os.hostname(), pid: process.pid, node: process.version },
  steps: [],
};

try {
  await queue.enqueue(job);
  report.steps.push({ step: 'enqueue', jobId: job.id });

  const first = await queue.claim({ workerId: 'worker-a-abandon', timeoutMs: 2_000, leaseMs: 400 });
  if (first?.id !== job.id) throw new Error('worker A failed to claim');
  report.steps.push({
    step: 'claim-a',
    claimedBy: first.claimedBy,
    leaseExpiresAt: first.leaseExpiresAt,
  });

  const blocked = await queue.claim({ workerId: 'worker-b', timeoutMs: 50, leaseMs: 5_000 });
  report.steps.push({ step: 'claim-b-while-leased', got: blocked });
  if (blocked !== null) throw new Error('worker B claimed while lease was live');

  await new Promise((resolve) => setTimeout(resolve, 500));
  const reclaimed = await queue.reclaimExpired();
  report.steps.push({ step: 'reclaimExpired', reclaimed });

  const second = await queue.claim({ workerId: 'worker-b', timeoutMs: 2_000, leaseMs: 5_000 });
  if (second?.id !== job.id || second.claimedBy !== 'worker-b') {
    throw new Error(`worker B reclaim claim failed: ${JSON.stringify(second)}`);
  }
  report.steps.push({
    step: 'claim-b-after-reclaim',
    claimedBy: second.claimedBy,
    leaseExpiresAt: second.leaseExpiresAt,
  });

  await queue.complete({
    jobId: job.id,
    ok: true,
    worker: { hostname: os.hostname(), pid: process.pid },
    result: { command: 'lease-smoke', exitCode: 0, tests: 1, passed: 1, failed: 0, skipped: 0, stdout: '', stderr: '' },
    completedAt: new Date().toISOString(),
  });
  report.steps.push({ step: 'complete-b', ok: true });
  report.ok = true;
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  await queue.close();
}

const outDir = path.join(repoRoot, 'evidence');
await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, `smoke-remote-work-lease-${stamp}.json`);
await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ ok: report.ok, evidence: outPath, error: report.error ?? null }, null, 2)}\n`);
process.exitCode = report.ok ? 0 : 1;
