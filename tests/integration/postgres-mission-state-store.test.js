import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { createPostgresClient } from '../../packages/postgres/src/postgres-client.js';
import {
  createPostgresMissionStateStore,
  resolveSharedMissionStoreOptions,
} from '../../packages/postgres/src/postgres-mission-state-store.js';

const clock = () => '2026-09-04T03:00:00.000Z';

function withAgentEnvelopes(service) {
  return {
    ...service,
    async transition(request) {
      if (!request.operationId || request.envelope) return service.transition(request);
      return service.transition({
        ...request,
        envelope: createAgentOperationEnvelope({
          record: { mission: { id: request.missionId }, revision: request.expectedRevision },
          operationId: request.operationId,
          agentId: request.signal.agent,
          objective: 'exercise shared mission state',
          createdAt: clock(),
        }),
      });
    },
  };
}

function createInput(id) {
  return {
    operationId: `op-create-${id}`,
    id,
    objective: 'Share authoritative mission state across hosts',
    goals: [{ id: 'goal-1', objective: 'Persist shared state' }],
    subgoals: [{ id: 'inspect', objective: 'Inspect repository', goalId: 'goal-1' }],
    dependencies: [],
    constraints: ['no model-authored completion'],
    permissions: [
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
    ],
    currentPlan: { id: 'plan-1', version: 1, steps: ['inspect'] },
    environmentObservations: [{ source: 'runtime', key: 'node_version', value: '24.14.1', observedAt: '2026-09-04T02:59:00.000Z' }],
  };
}

test('shared mission store options return null when nothing is configured', () => {
  assert.equal(resolveSharedMissionStoreOptions({}), null);
  assert.equal(resolveSharedMissionStoreOptions({ PATH: '/usr/bin' }), null);
});

test('shared mission store options require a postgres url when any mesh postgres signal is set', () => {
  assert.throws(
    () => resolveSharedMissionStoreOptions({ ATHERE_MESH_POSTGRES_PASSWORD_FILE: '/tmp/x' }),
    /ATHERE_MESH_POSTGRES_URL|DATABASE_URL/i,
  );
  assert.throws(
    () => resolveSharedMissionStoreOptions({ ATHERE_MESH_POSTGRES_URL: 'not-a-url' }),
    /postgres/i,
  );
});

test('shared mission store options accept ATHERE_MESH_POSTGRES_URL or DATABASE_URL', () => {
  const fromMesh = resolveSharedMissionStoreOptions({
    ATHERE_MESH_POSTGRES_URL: 'postgres://mesh:secret@100.77.131.28:5432/athere_mesh',
  });
  assert.equal(fromMesh.databaseUrl, 'postgres://mesh:secret@100.77.131.28:5432/athere_mesh');
  assert.equal(fromMesh.mode, 'live');

  const fromLegacy = resolveSharedMissionStoreOptions({
    DATABASE_URL: 'postgresql://mesh:secret@127.0.0.1:5432/athere_mesh',
  });
  assert.equal(fromLegacy.databaseUrl, 'postgresql://mesh:secret@127.0.0.1:5432/athere_mesh');
  assert.equal(fromLegacy.mode, 'live');
});

test('shared mission store options can inject a password from a mode-600 file', async () => {
  const { mkdtemp, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = await mkdtemp(path.join(tmpdir(), 'athere-pg-pass-'));
  const passwordFile = path.join(dir, 'mesh-postgres.pass');
  await writeFile(passwordFile, 'file-secret\n', { encoding: 'utf8', mode: 0o600 });
  const resolved = resolveSharedMissionStoreOptions({
    ATHERE_MESH_POSTGRES_URL: 'postgres://athere_mesh@127.0.0.1:5432/athere_mesh',
    ATHERE_MESH_POSTGRES_PASSWORD_FILE: passwordFile,
  });
  assert.match(resolved.databaseUrl, /athere_mesh:file-secret@127\.0\.0\.1:5432\/athere_mesh/);
});

test('Postgres mission-state store adapts loadMission/saveMission for the state service', async () => {
  const db = new PGlite();
  const store = await createPostgresMissionStateStore({ db });
  assert.equal(typeof store.loadMission, 'function');
  assert.equal(typeof store.saveMission, 'function');

  const service = withAgentEnvelopes(createMissionStateService({
    root: '/shared-state-unused-by-postgres',
    clock,
    store,
  }));

  const missionId = `mission-shared-${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const created = await service.create(createInput(missionId));
  assert.equal(created.revision, 1);
  assert.equal(created.mission.id, missionId);

  const otherService = withAgentEnvelopes(createMissionStateService({
    root: '/shared-state-unused-by-postgres',
    clock,
    store,
  }));
  const loaded = await otherService.get({ missionId });
  assert.equal(loaded.revision, 1);
  assert.equal(loaded.mission.objective, 'Share authoritative mission state across hosts');
  assert.deepEqual(loaded.mission.pendingWork, ['inspect']);

  const executed = await otherService.transition({
    operationId: `op-exec-${missionId}`,
    missionId,
    expectedRevision: loaded.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'evidence recorded' },
    update: {
      evidence: [{ id: 'evidence-inspect', kind: 'repository_observation', agent: 'nyx' }],
      activeAgents: ['nyx'],
    },
  });
  assert.equal(executed.revision, 2);

  const again = await service.get({ missionId });
  assert.equal(again.revision, 2);
  assert.equal(again.mission.evidence[0].id, 'evidence-inspect');

  await db.close();
});

test('Postgres mission-state store rejects stale revisions through the state service', async () => {
  const db = new PGlite();
  const store = await createPostgresMissionStateStore({ db });
  const service = withAgentEnvelopes(createMissionStateService({
    root: '/shared-state-unused-by-postgres',
    clock,
    store,
  }));
  const missionId = `mission-cas-${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const created = await service.create(createInput(missionId));

  await service.transition({
    operationId: `op-exec-${missionId}`,
    missionId,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'first writer' },
    update: {
      evidence: [{ id: 'evidence-1', kind: 'repository_observation', agent: 'nyx' }],
      activeAgents: ['nyx'],
    },
  });

  await assert.rejects(
    () => service.transition({
      operationId: `op-stale-${missionId}`,
      missionId,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx', detail: 'stale writer' },
      update: {
        evidence: [{ id: 'evidence-stale', kind: 'repository_observation', agent: 'nyx' }],
        activeAgents: ['nyx'],
      },
    }),
    /revision conflict/i,
  );

  const current = await service.get({ missionId });
  assert.equal(current.revision, 2);
  assert.equal(current.mission.evidence[0].id, 'evidence-1');
  await db.close();
});

test('createMissionStateService stays on the filesystem store when no shared store is injected', async () => {
  // Hermetic offline default: no postgres wiring unless the caller injects a store.
  // This case only asserts the factory still constructs without a store argument.
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const root = await mkdtemp(path.join(tmpdir(), 'athere-fs-default-'));
  const service = createMissionStateService({ root, clock });
  const missionId = `mission-fs-${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const created = await service.create(createInput(missionId));
  assert.equal(created.revision, 1);
  const loaded = await service.get({ missionId });
  assert.equal(loaded.mission.id, missionId);
});

// ---------------------------------------------------------------------------
// Live shared Postgres: skip cleanly when ATHERE_MESH_POSTGRES_URL / DATABASE_URL
// is absent or unreachable so `pnpm test` stays offline-first.
// ---------------------------------------------------------------------------

const liveOptions = resolveSharedMissionStoreOptions(process.env);

async function probeLive(options) {
  try {
    const client = await createPostgresClient({ mode: 'live', databaseUrl: options.databaseUrl });
    try {
      await client.query('SELECT 1 AS ok');
      return { client, reason: null };
    } catch (error) {
      await client.close().catch(() => {});
      return { client: null, reason: error.message };
    }
  } catch (error) {
    return { client: null, reason: error.message };
  }
}

const liveProbe = liveOptions === null
  ? { client: null, reason: 'ATHERE_MESH_POSTGRES_URL / DATABASE_URL not configured (offline default)' }
  : await probeLive(liveOptions);
const liveSkip = liveProbe.reason === null ? false : `shared Postgres unavailable — ${liveProbe.reason}`;
const liveClient = liveProbe.client;

test('live shared Postgres: two service instances share authoritative mission state', { skip: liveSkip }, async () => {
  const store = await createPostgresMissionStateStore({ db: liveClient });
  const writer = withAgentEnvelopes(createMissionStateService({
    root: '/shared-state-unused-by-postgres',
    clock,
    store,
  }));
  const reader = withAgentEnvelopes(createMissionStateService({
    root: '/shared-state-unused-by-postgres',
    clock,
    store,
  }));
  const missionId = `mission-live-${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  const created = await writer.create(createInput(missionId));
  const loaded = await reader.get({ missionId });
  assert.equal(loaded.revision, created.revision);
  assert.equal(loaded.mission.objective, created.mission.objective);
});

after(async () => {
  if (liveClient) await liveClient.close();
});
