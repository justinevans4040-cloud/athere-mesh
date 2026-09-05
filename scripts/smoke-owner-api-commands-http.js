import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTitanService } from './start-agent-api.js';

// HTTP POST /api/commands on the owner API with env-wired Redis + remote queue
// (+ optional Postgres). Standing Ichabod worker must already be running.
//
//   ATHERE_MESH_REDIS_* ... \
//   ATHERE_MESH_REMOTE_WORK_QUEUE=1 \
//   ATHERE_MESH_REMOTE_REPOSITORY_ROOT=/home/the_founder/athere-mesh \
//   node scripts/smoke-owner-api-commands-http.js
//
// Writes evidence/smoke-owner-api-commands-http-crosshost-<stamp>.json

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
    throw new Error(`${name} is required for owner-api HTTP commands smoke`);
  }
  return value.trim();
}

async function sha256File(filePath) {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').slice(0, 15);
const remoteRoot = requireEnv('ATHERE_MESH_REMOTE_REPOSITORY_ROOT');
if (!['1', 'true', 'yes', 'on'].includes(String(process.env.ATHERE_MESH_REMOTE_WORK_QUEUE ?? '').toLowerCase())) {
  throw new Error('ATHERE_MESH_REMOTE_WORK_QUEUE must be truthy for owner-api HTTP commands smoke');
}

const authToken = process.env.TITAN_API_BEARER_TOKEN?.trim()
  || `smoke-http-${randomBytes(24).toString('hex')}`;
const workspaceRoot = path.join(repoRoot, 'workspace', 'titan-owner-http-smoke', stamp);
await mkdir(workspaceRoot, { recursive: true });

const environment = {
  ...process.env,
  TITAN_API_BEARER_TOKEN: authToken,
  TITAN_WORKSPACE_ROOT: path.relative(repoRoot, workspaceRoot).replaceAll('\\', '/'),
  TITAN_API_HOST: '127.0.0.1',
  TITAN_API_PORT: process.env.TITAN_API_PORT ?? '0',
};

const service = await createTitanService({ environment, repositoryRoot: repoRoot });
const startedAt = new Date().toISOString();
let result = null;
let error = null;
let baseUrl = null;

try {
  await service.listen();
  baseUrl = service.url;
  if (service.meshWiring?.redisBus !== true || service.meshWiring?.remoteWorkQueue !== true) {
    throw new Error(`expected redisBus+remoteWorkQueue wiring, got ${JSON.stringify(service.meshWiring)}`);
  }

  const response = await fetch(new URL('/api/commands', baseUrl), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${authToken}`,
      'content-type': 'text/plain; charset=utf-8',
    },
    body: 'test all of Titan',
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  if (body?.mission?.status !== 'completed') {
    throw new Error(`mission status ${body?.mission?.status ?? '<missing>'}`);
  }
  result = body;
} catch (err) {
  error = err instanceof Error ? err.message : String(err);
} finally {
  await service.close();
}

const evidence = {
  ok: error === null && result?.mission?.status === 'completed',
  smoke: 'owner-api-commands-http-crosshost',
  claim: 'Lenovo owner HTTP POST /api/commands with env-wired Redis bus + remote work queue completes inspect+run-node-tests on the standing Ichabod worker (zero mid-flight SSH claim).',
  at: new Date().toISOString(),
  startedAt,
  runtime: 'athere-mesh',
  dispatcher: {
    hostname: os.hostname(),
    pid: process.pid,
    node: process.version,
    tailnet: tailnetAddresses(),
  },
  wiring: service.meshWiring ?? null,
  baseUrl,
  remoteRepositoryRoot: remoteRoot,
  workNamespace: process.env.ATHERE_MESH_WORK_NAMESPACE ?? 'athere:mesh:work',
  seedId: process.env.ATHERE_MESH_REDIS_SEED_ID,
  sources: {
    'start-agent-api.js': await sha256File(path.join(repoRoot, 'scripts/start-agent-api.js')),
    'titan-api.js': await sha256File(path.join(repoRoot, 'packages/api/src/titan-api.js')),
    'mission-orchestrator.js': await sha256File(path.join(repoRoot, 'packages/orchestrator/src/mission-orchestrator.js')),
    'node-test-executor.js': await sha256File(path.join(repoRoot, 'packages/execution/src/node-test-executor.js')),
  },
  result: result === null ? null : {
    status: result.mission?.status,
    missionId: result.mission?.id,
    completedWork: result.mission?.completedWork,
    tests: result.tests,
    proof: result.mission?.proof ?? null,
  },
  error,
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
        sharedProofStore: service.meshWiring?.sharedProofStore === true,
      };
    } catch {
      return null;
    }
  })(),
  doesNotProve: [
    'multi-writer orchestrator beyond revision CAS',
    ...((() => {
      const gaps = [];
      try {
        const url = process.env.ATHERE_MESH_POSTGRES_URL || process.env.DATABASE_URL;
        if (!url) {
          gaps.push('Postgres shared store (not configured for this process)');
          gaps.push('Shared proof store across hosts');
          return gaps;
        }
        const parsed = new URL(url);
        if (!(parsed.hostname.startsWith('100.') && parsed.port !== '15432')) {
          gaps.push('Postgres Tailscale-native without tunnel (this run still used a non-100.x or tunnel endpoint)');
        }
        if (service.meshWiring?.sharedProofStore !== true) {
          gaps.push('Shared proof store across hosts (proofs remain owner-workspace FS unless wired)');
        }
      } catch {
        gaps.push('Postgres endpoint parse failed');
      }
      return gaps;
    })()),
  ],
  midFlightSshClaim: false,
};

const outDir = path.join(repoRoot, 'evidence');
await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, `smoke-owner-api-commands-http-crosshost-${stamp}.json`);
await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ ok: evidence.ok, evidence: outPath, wiring: evidence.wiring, error }, null, 2)}\n`);
process.exitCode = evidence.ok ? 0 : 1;
