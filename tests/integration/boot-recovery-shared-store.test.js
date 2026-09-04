import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMission } from '../../packages/contracts/src/mission.js';
import { createTitanService } from '../../scripts/start-agent-api.js';

const OWNER_TOKEN = 'test-owner-token-0123456789abcdef0123456789';

test('boot recovery heals interrupted missions from wired shared store (not filesystem-only)', async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'titan-boot-shared-'));
  const mission = createMission({
    id: 'mission-shared-only',
    intent: 'test all of Titan',
    clock: () => '2026-09-05T20:00:00.000Z',
  });
  // Shared-only: no filesystem snapshot under workspace/missions.
  const shared = new Map([
    [mission.id, Object.freeze({ revision: 1, mission })],
  ]);
  const store = Object.freeze({
    async listMissionIds() {
      return Object.freeze([...shared.keys()].sort());
    },
    async loadMission({ missionId }) {
      const record = shared.get(missionId);
      if (!record) throw new Error('mission snapshot not found');
      return record;
    },
    async saveMission({ mission: next, expectedRevision }) {
      const current = shared.get(next.id);
      const currentRevision = current?.revision ?? 0;
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        throw new Error(`revision conflict: expected ${expectedRevision}, found ${currentRevision}`);
      }
      const record = Object.freeze({ revision: currentRevision + 1, mission: next });
      shared.set(next.id, record);
      return record;
    },
  });

  const api = await createTitanService({
    environment: {
      TITAN_API_BEARER_TOKEN: OWNER_TOKEN,
      OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
      OLLAMA_MODEL: 'test-model',
    },
    repositoryRoot,
    meshDeps: Object.freeze({
      bus: undefined,
      remoteWorkQueue: undefined,
      remoteRepositoryRoot: undefined,
      store,
      wired: Object.freeze({
        redisBus: false,
        remoteWorkQueue: false,
        sharedMissionStore: true,
      }),
      async close() {},
    }),
  });
  await api.listen({ host: '127.0.0.1', port: 0 });
  try {
    const health = await fetch(`${api.url}/health`, {
      headers: { authorization: `Bearer ${OWNER_TOKEN}` },
    }).then((response) => response.json());
    assert.equal(health.recovery.recovered, 1);
    const record = await store.loadMission({ missionId: 'mission-shared-only' });
    assert.equal(record.mission.status, 'blocked');
    assert.equal(record.mission.signals.at(-1).detail, 'interrupted execution requires operator retry');
    assert.equal(api.meshWiring.sharedMissionStore, true);
  } finally {
    await api.close();
  }
});
