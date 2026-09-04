import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createMissionStateService } from '../packages/mission/src/mission-state-service.js';
import {
  openSharedMissionStateStore,
  resolveSharedMissionStoreOptions,
} from '../packages/postgres/src/postgres-mission-state-store.js';

// Cross-host shared mission-state smoke. Same script on both hosts:
//
//   node scripts/smoke-shared-mission-state.js write --mission <id>
//   node scripts/smoke-shared-mission-state.js read  --mission <id>
//
// Connection details come from ATHERE_MESH_POSTGRES_* / DATABASE_URL only, so no
// password is ever written into this repository. Prints one JSON object on stdout.

const USAGE = 'usage: node scripts/smoke-shared-mission-state.js <write|read> [--mission id] [--objective text]';

function parseArgs(argv) {
  const mode = argv[0];
  if (mode !== 'write' && mode !== 'read') throw new Error(USAGE);
  const flags = {};
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index];
    if (!name?.startsWith('--')) throw new Error(USAGE);
    flags[name.slice(2)] = argv[index + 1];
  }
  return { mode, flags };
}

function tailnetAddresses() {
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, addresses]) => (addresses ?? []).map((address) => ({ name, ...address })))
    .filter((address) => address.family === 'IPv4' && Number(address.address.split('.')[1]) >= 64
      && Number(address.address.split('.')[1]) <= 127 && address.address.startsWith('100.'))
    .map((address) => ({ interface: address.name, address: address.address }));
}

function identity() {
  return {
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    nodeVersion: process.version,
    tailnet: tailnetAddresses(),
    pid: process.pid,
  };
}

const { mode, flags } = parseArgs(process.argv.slice(2));
const resolved = resolveSharedMissionStoreOptions(process.env);
if (resolved === null) {
  throw new Error('ATHERE_MESH_POSTGRES_URL or DATABASE_URL must be set (optional ATHERE_MESH_POSTGRES_PASSWORD_FILE)');
}

const missionId = flags.mission ?? `mission-shared-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const objective = flags.objective ?? `Shared mission state smoke on ${os.hostname()}`;
const startedAt = new Date().toISOString();
const handle = await openSharedMissionStateStore(process.env);
if (handle === null) throw new Error('shared mission store failed to open');

const report = {
  ok: false,
  smoke: 'shared-mission-state',
  mode,
  process: identity(),
  store: {
    backend: 'postgres',
    host: handle.databaseUrlHost,
    // Never echo credentials. Host/port only.
  },
  missionId,
  startedAt,
  finishedAt: null,
  revision: null,
  objective: null,
  notClaimed: [
    'doctrine baseline Agent A → Agent B complete',
    'remote executor dispatch',
    'orchestrator auto-wiring of shared store',
    'multi-writer safety beyond revision CAS',
  ],
};

try {
  const service = createMissionStateService({
    root: '/shared-state-unused-by-postgres',
    clock: () => new Date().toISOString(),
    store: handle.store,
  });

  if (mode === 'write') {
    const created = await service.create({
      operationId: `op-smoke-create-${missionId}`,
      id: missionId,
      objective,
      goals: [{ id: 'goal-1', objective: 'Cross-host shared state' }],
      subgoals: [{ id: 'inspect', objective: 'Inspect repository', goalId: 'goal-1' }],
      dependencies: [],
      constraints: ['shared-store-smoke'],
      permissions: [{ actor: 'titan', actions: ['create_mission'] }],
      currentPlan: { id: 'plan-1', version: 1, steps: ['inspect'] },
      environmentObservations: [{
        source: 'smoke',
        key: 'writer_host',
        value: os.hostname(),
        observedAt: startedAt,
      }],
    });
    report.revision = created.revision;
    report.objective = created.mission.objective;
    report.writerObservation = created.mission.environmentObservations[0];
    report.ok = created.revision === 1 && created.mission.id === missionId;
  } else {
    const loaded = await service.get({ missionId });
    report.revision = loaded.revision;
    report.objective = loaded.mission.objective;
    report.writerObservation = loaded.mission.environmentObservations?.[0] ?? null;
    report.ok = loaded.mission.id === missionId && typeof loaded.mission.objective === 'string';
  }
} finally {
  report.finishedAt = new Date().toISOString();
  await handle.close();
}

process.stdout.write(`${JSON.stringify(report)}\n`);
if (!report.ok) process.exitCode = 1;
