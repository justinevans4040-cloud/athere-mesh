import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNodeTestExecutor } from '../packages/execution/src/node-test-executor.js';
import { resolveMeshOrchestratorDeps } from '../packages/orchestrator/src/mesh-env-wiring.js';
import { createMissionOrchestrator } from '../packages/orchestrator/src/mission-orchestrator.js';

// Owner-path live mission over env-wired Redis bus + remote work queue
// (+ optional Postgres). Standing Ichabod worker must already be running.
//
//   ATHERE_MESH_REDIS_* ... \
//   ATHERE_MESH_REMOTE_WORK_QUEUE=1 \
//   ATHERE_MESH_REMOTE_REPOSITORY_ROOT=/home/the_founder/athere-mesh \
//   node scripts/smoke-owner-api-mission.js
//
// Writes evidence/smoke-owner-api-mission-crosshost-<stamp>.json

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tailnetAddresses() {
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, addresses]) => (addresses ?? []).map((address) => ({ name, ...address })))
    .filter((address) => address.family === 'IPv4' && Number(address.address.split('.')[1]) >= 64
      && Number(address.address.split('.')[1]) <= 127 && address.address.startsWith('100.'))
    .map((address) => ({ interface: address.name, address: address.address }));
}

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required for owner-api mission smoke`);
  }
  return value.trim();
}

async function sha256File(filePath) {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').slice(0, 15);
const remoteRoot = requireEnv('ATHERE_MESH_REMOTE_REPOSITORY_ROOT');
if (process.env.ATHERE_MESH_REMOTE_WORK_QUEUE !== '1'
  && process.env.ATHERE_MESH_REMOTE_WORK_QUEUE !== 'true'
  && process.env.ATHERE_MESH_REMOTE_WORK_QUEUE !== 'yes'
  && process.env.ATHERE_MESH_REMOTE_WORK_QUEUE !== 'on') {
  throw new Error('ATHERE_MESH_REMOTE_WORK_QUEUE must be truthy for owner-api mission smoke');
}

const workspaceRoot = path.join(repoRoot, 'workspace', 'titan-owner-smoke', stamp);
await mkdir(workspaceRoot, { recursive: true });

const mesh = await resolveMeshOrchestratorDeps(process.env);
if (mesh.wired.redisBus !== true || mesh.wired.remoteWorkQueue !== true) {
  await mesh.close();
  throw new Error(`expected redisBus+remoteWorkQueue wiring, got ${JSON.stringify(mesh.wired)}`);
}

const localExecutor = createNodeTestExecutor({ repositoryRoot: repoRoot });
const orchestrator = createMissionOrchestrator({
  root: workspaceRoot,
  repositoryRoot: repoRoot,
  executor: localExecutor,
  bus: mesh.bus,
  remoteWorkQueue: mesh.remoteWorkQueue,
  remoteRepositoryRoot: remoteRoot,
  ...(mesh.store === undefined ? {} : { store: mesh.store }),
  ...(mesh.proofStore === undefined ? {} : { proofStore: mesh.proofStore }),
});

const startedAt = new Date().toISOString();
let result;
let error;
try {
  result = await orchestrator.execute({
    profile: 'owner',
    text: 'test all of Titan',
  });
} catch (err) {
  error = err instanceof Error ? err.message : String(err);
} finally {
  await mesh.close();
}

const evidence = {
  ok: error === undefined && result?.mission?.status === 'completed',
  smoke: 'owner-api-mission-crosshost',
  claim: 'Lenovo owner orchestrator.execute() with env-wired Redis bus + remote work queue completes inspect+run-node-tests on the standing Ichabod worker (zero mid-flight SSH claim). Optional shared Postgres is recorded when wired.',
  at: new Date().toISOString(),
  startedAt,
  runtime: 'athere-mesh',
  dispatcher: {
    hostname: os.hostname(),
    pid: process.pid,
    node: process.version,
    tailnet: tailnetAddresses(),
  },
  wiring: mesh.wired,
  remoteRepositoryRoot: remoteRoot,
  workNamespace: process.env.ATHERE_MESH_WORK_NAMESPACE ?? 'athere:mesh:work',
  seedId: process.env.ATHERE_MESH_REDIS_SEED_ID,
  sources: {
    'mission-orchestrator.js': await sha256File(path.join(repoRoot, 'packages/orchestrator/src/mission-orchestrator.js')),
    'remote-dispatch-executor.js': await sha256File(path.join(repoRoot, 'packages/execution/src/remote-dispatch-executor.js')),
    'remote-work-queue.js': await sha256File(path.join(repoRoot, 'packages/execution/src/remote-work-queue.js')),
    'node-test-executor.js': await sha256File(path.join(repoRoot, 'packages/execution/src/node-test-executor.js')),
    'mesh-env-wiring.js': await sha256File(path.join(repoRoot, 'packages/orchestrator/src/mesh-env-wiring.js')),
  },
  result: result === undefined ? null : {
    status: result.mission?.status,
    missionId: result.mission?.id,
    completedWork: result.mission?.completedWork,
    tests: result.tests,
    healed: result.healed === true,
    executiveNextAction: result.executive?.nextAction ?? null,
    inspection: result.mission?.signals?.find((signal) => signal.agent === 'nyx')?.evidence?.result ?? null,
    runeWorkerHint: result.mission?.signals?.find((signal) => signal.agent === 'rune')?.evidence?.result?.command ?? null,
  },
  error: error ?? null,
  postgresEndpoint: (() => {
    try {
      const url = process.env.ATHERE_MESH_POSTGRES_URL || process.env.DATABASE_URL;
      if (!url) return null;
      const parsed = new URL(url);
      return {
        host: parsed.hostname,
        port: parsed.port || '5432',
        tailscaleNative: parsed.hostname.startsWith('100.'),
        sshTunnelLocalPort: parsed.port === '15432',
      };
    } catch {
      return null;
    }
  })(),
  doesNotProve: [
    'HTTP POST /api/commands cross-host (this smoke uses orchestrator.execute directly)',
    'multi-writer orchestrator beyond revision CAS',
    'Ichabod worker checkout byte-identical to Lenovo HEAD (worker may lag; Lenovo orchestrator SHA is authoritative for owner path)',
    ...((() => {
      try {
        const url = process.env.ATHERE_MESH_POSTGRES_URL || process.env.DATABASE_URL;
        if (!url) return ['Postgres shared store (not configured for this process)'];
        const parsed = new URL(url);
        if (parsed.hostname.startsWith('100.') && parsed.port !== '15432') return [];
        return ['Postgres Tailscale-native without tunnel (this run still used a non-100.x or tunnel endpoint)'];
      } catch {
        return ['Postgres endpoint parse failed'];
      }
    })()),
  ],
  midFlightSshClaim: false,
};

const outDir = path.join(repoRoot, 'evidence');
await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, `smoke-owner-api-mission-crosshost-${stamp}.json`);
await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ ok: evidence.ok, evidence: outPath, wiring: mesh.wired, error }, null, 2)}\n`);
process.exitCode = evidence.ok ? 0 : 1;
