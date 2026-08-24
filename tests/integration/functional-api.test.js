import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentRuntime } from '../../packages/agent/src/agent-runtime.js';
import { createTitanApi } from '../../packages/api/src/titan-api.js';
import { fleetRegistry } from '../../packages/fleet/src/registry.js';
import { createTitanService } from '../../scripts/start-agent-api.js';
import { createMission } from '../../packages/contracts/src/mission.js';
import { saveMission, loadMission } from '../../packages/mission/src/mission-store.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function createOrchestrator() {
  const missions = new Map();
  let sequence = 0;
  return {
    async execute({ profile, text }) {
      assert.equal(profile, 'owner');
      assert.equal(text, 'test all of Titan');
      sequence += 1;
      const mission = Object.freeze({
        id: `mission-api-${sequence}`,
        status: 'completed',
        proof: { verified: true, path: `proofs/mission-api-${sequence}.json`, sha256: 'a'.repeat(64) },
      });
      const result = Object.freeze({ revision: 3, mission, tests: { tests: 4, passed: 4, failed: 0, skipped: 0 } });
      missions.set(mission.id, result);
      return result;
    },
    async getMission({ missionId }) {
      const result = missions.get(missionId);
      if (!result) throw new Error('mission snapshot not found');
      return result;
    },
  };
}

async function startFunctionalApi({ maxRequestBytes } = {}) {
  const runtime = createAgentRuntime({ complete: async () => ({ content: 'advisory only' }) });
  const api = createTitanApi({
    runtime,
    profile: 'owner',
    orchestrator: createOrchestrator(),
    team: fleetRegistry,
    recovery: { recovered: ['mission-recovered'], blocked: [], corrupt: [] },
    ...(maxRequestBytes === undefined ? {} : { maxRequestBytes }),
  });
  await api.listen({ host: '127.0.0.1', port: 0 });
  return api;
}

async function request(api, pathname, { method = 'GET', body } = {}) {
  const response = await fetch(`${api.url}${pathname}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'text/plain; charset=utf-8' }, body }),
  });
  return { status: response.status, body: await response.json() };
}

test('functional API exposes health, operational team, durable command result, and mission retrieval', async () => {
  const api = await startFunctionalApi();
  try {
    const health = await request(api, '/health');
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, {
      ready: true,
      enabledAgents: 6,
      recovery: { recovered: ['mission-recovered'], blocked: [], corrupt: [] },
    });

    const team = await request(api, '/api/team');
    assert.equal(team.status, 200);
    assert.equal(team.body.enabledAgents, 6);
    assert.equal(team.body.agents.length, 25);
    assert.deepEqual(
      team.body.agents.filter(({ enabled }) => enabled).map(({ id, executorId, operational }) => ({ id, executorId, operational })),
      [
        { id: 'miss-vale-prime', executorId: 'mission-supervisor', operational: true },
        { id: 'agent-vale', executorId: 'ollama-chat', operational: true },
        { id: 'nyx', executorId: 'repository-inspector', operational: true },
        { id: 'rune', executorId: 'node-test-runner', operational: true },
        { id: 'qra_emerge_audit', executorId: 'proof-verifier', operational: true },
        { id: 'qra_recovery_driver', executorId: 'recovery-coordinator', operational: true },
      ],
    );

    const command = await request(api, '/api/commands', { method: 'POST', body: 'test all of Titan' });
    assert.equal(command.status, 200);
    assert.equal(command.body.mission.status, 'completed');
    assert.equal(command.body.tests.failed, 0);

    const mission = await request(api, `/api/missions/${command.body.mission.id}`);
    assert.equal(mission.status, 200);
    assert.equal(mission.body.mission.id, command.body.mission.id);

    const advisoryExecution = await request(api, '/api/chat?agent=nyx', { method: 'POST', body: 'test Titan' });
    assert.equal(advisoryExecution.status, 409);
    assert.deepEqual(advisoryExecution.body, { error: 'execution request must use /api/commands' });
  } finally {
    await api.close();
  }
});

test('functional API rejects invalid mission routes, unknown routes, and oversized command bodies', async () => {
  const api = await startFunctionalApi({ maxRequestBytes: 16 });
  try {
    assert.equal((await request(api, '/api/missions/invalid%2Fid')).status, 400);
    assert.equal((await request(api, '/not-a-route')).status, 404);
    const oversized = await request(api, '/api/commands', { method: 'POST', body: 'x'.repeat(17) });
    assert.equal(oversized.status, 413);
  } finally {
    await api.close();
  }
});

test('startup composition validates the fleet and recovers interrupted missions before serving health', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-functional-startup-'));
  await saveMission({
    root,
    mission: createMission({ id: 'mission-startup-recovery', intent: 'test all of Titan', clock: () => '2026-08-23T12:00:00.000Z' }),
  });
  const api = await createTitanService({
    environment: { TITAN_WORKSPACE_ROOT: root, OLLAMA_BASE_URL: 'http://127.0.0.1:11434', OLLAMA_MODEL: 'test-model' },
    repositoryRoot: process.cwd(),
  });
  await api.listen({ host: '127.0.0.1', port: 0 });
  try {
    assert.deepEqual((await request(api, '/health')).body.recovery.recovered, ['mission-startup-recovery']);
    const record = await loadMission({ root, missionId: 'mission-startup-recovery' });
    assert.equal(record.mission.status, 'blocked');
    assert.equal(record.mission.signals.at(-1).detail, 'interrupted execution requires operator retry');
  } finally {
    await api.close();
  }
});
