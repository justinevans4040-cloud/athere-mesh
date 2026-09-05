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

const OWNER_TOKEN = 'test-owner-token-0123456789abcdef0123456789';

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

async function startFunctionalApi({
  maxRequestBytes,
  orchestrator = createOrchestrator(),
  logger,
  authToken = OWNER_TOKEN,
  recovery = { recovered: ['mission-recovered'], blocked: [], corrupt: [] },
  hostLabel,
} = {}) {
  const runtime = createAgentRuntime({ complete: async () => ({ content: 'advisory only' }) });
  const api = createTitanApi({
    runtime,
    profile: 'owner',
    authToken,
    orchestrator,
    team: fleetRegistry,
    recovery,
    ...(maxRequestBytes === undefined ? {} : { maxRequestBytes }),
    ...(logger === undefined ? {} : { logger }),
    ...(hostLabel === undefined ? {} : { hostLabel }),
  });
  await api.listen({ host: '127.0.0.1', port: 0 });
  return api;
}

test('owner bearer credentials are 32-512 visible printable ASCII bytes', () => {
  const runtime = createAgentRuntime({ complete: async () => ({ content: 'not used' }) });
  for (const invalidToken of ['é'.repeat(32), 'x'.repeat(513)]) {
    assert.throws(
      () => createTitanApi({ runtime, profile: 'owner', authToken: invalidToken }),
      /strong bearer credential/,
    );
  }
});

async function request(api, pathname, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${api.url}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${OWNER_TOKEN}`,
      ...(body === undefined ? {} : { 'content-type': 'text/plain; charset=utf-8' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body }),
  });
  return { status: response.status, body: await response.json() };
}

test('owner routes require bearer authentication and reject cross-site browser requests before work begins', async () => {
  let executionCalls = 0;
  let retrievalCalls = 0;
  let completionCalls = 0;
  const runtime = createAgentRuntime({
    complete: async () => {
      completionCalls += 1;
      return { content: 'must not run' };
    },
  });
  const api = createTitanApi({
    runtime,
    profile: 'owner',
    authToken: OWNER_TOKEN,
    orchestrator: {
      async execute() { executionCalls += 1; return { status: 'blocked' }; },
      async getMission() { retrievalCalls += 1; throw new Error('mission snapshot not found'); },
    },
    team: fleetRegistry,
    recovery: { recovered: [], blocked: [], corrupt: [] },
  });
  await api.listen({ host: '127.0.0.1', port: 0 });
  try {
    const health = await fetch(`${api.url}/health`);
    const team = await fetch(`${api.url}/api/team`);
    const command = await fetch(`${api.url}/api/commands`, {
      method: 'POST', headers: { 'content-type': 'text/plain; charset=utf-8' }, body: 'test all of Titan',
    });
    const mission = await fetch(`${api.url}/api/missions/mission-secret`);
    const chat = await fetch(`${api.url}/api/chat?agent=agent-vale`, {
      method: 'POST', headers: { 'content-type': 'text/plain; charset=utf-8' }, body: 'hello Titan',
    });
    const crossSite = await fetch(`${api.url}/api/commands`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${OWNER_TOKEN}`,
        'content-type': 'text/plain; charset=utf-8',
        origin: 'https://attacker.example',
        'sec-fetch-site': 'cross-site',
      },
      body: 'test all of Titan',
    });

    assert.deepEqual(
      [health.status, team.status, command.status, mission.status, chat.status, crossSite.status],
      [401, 401, 401, 401, 401, 403],
    );
    assert.match(command.headers.get('www-authenticate') ?? '', /^Bearer\b/);
    assert.deepEqual({ executionCalls, retrievalCalls, completionCalls }, { executionCalls: 0, retrievalCalls: 0, completionCalls: 0 });
  } finally {
    await api.close();
  }
});

test('command admission is single-flight and releases after blocked results and thrown errors', async () => {
  let releaseFirst;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const calls = [];
  const api = await startFunctionalApi({
    authToken: OWNER_TOKEN,
    orchestrator: {
      async execute({ text }) {
        calls.push(text);
        if (text === 'hold') {
          markStarted();
          await new Promise((resolve) => { releaseFirst = resolve; });
          return { status: 'blocked', reason: 'held command released' };
        }
        if (text === 'throw') throw new Error('simulated executor failure');
        return { status: 'blocked', reason: 'retry admitted' };
      },
      async getMission() { throw new Error('mission snapshot not found'); },
    },
    logger: { error() {} },
  });
  try {
    const first = fetch(`${api.url}/api/commands`, {
      method: 'POST', headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'content-type': 'text/plain; charset=utf-8' }, body: 'hold',
    });
    await started;
    const concurrent = await fetch(`${api.url}/api/commands`, {
      method: 'POST', headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'content-type': 'text/plain; charset=utf-8' }, body: 'concurrent',
    });
    releaseFirst();
    assert.equal((await first).status, 200);
    assert.equal(concurrent.status, 429);
    assert.equal(concurrent.headers.get('retry-after'), '1');

    const thrown = await fetch(`${api.url}/api/commands`, {
      method: 'POST', headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'content-type': 'text/plain; charset=utf-8' }, body: 'throw',
    });
    const retry = await fetch(`${api.url}/api/commands`, {
      method: 'POST', headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'content-type': 'text/plain; charset=utf-8' }, body: 'retry',
    });
    assert.deepEqual([thrown.status, retry.status], [500, 200]);
    assert.deepEqual(calls, ['hold', 'throw', 'retry']);
  } finally {
    await api.close();
  }
});

test('advisory client errors use stable non-500 public responses', async () => {
  const runtime = createAgentRuntime({ complete: async () => ({ content: 'must not run' }) });
  const api = createTitanApi({
    runtime,
    profile: 'owner',
    authToken: OWNER_TOKEN,
    team: fleetRegistry,
    orchestrator: createOrchestrator(),
    recovery: { recovered: [], blocked: [], corrupt: [] },
  });
  await api.listen({ host: '127.0.0.1', port: 0 });
  try {
    const empty = await fetch(`${api.url}/api/chat?agent=agent-vale`, {
      method: 'POST', headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'content-type': 'text/plain; charset=utf-8' }, body: '   ',
    });
    const unknown = await fetch(`${api.url}/api/chat?agent=not-a-real-agent`, {
      method: 'POST', headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'content-type': 'text/plain; charset=utf-8' }, body: 'hello',
    });
    assert.deepEqual(
      [
        { status: empty.status, body: await empty.json() },
        { status: unknown.status, body: await unknown.json() },
      ],
      [
        { status: 400, body: { error: 'text must be non-empty' } },
        { status: 400, body: { error: 'unknown agent' } },
      ],
    );
  } finally {
    await api.close();
  }
});

test('command deck UI is served on loopback; owner token only on same-origin bootstrap', async () => {
  const api = await startFunctionalApi({ hostLabel: 'test-deck-host' });
  try {
    const home = await fetch(`${api.url}/`);
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type') || '', /text\/html/);
    const html = await home.text();
    assert.match(html, /COMMAND DECK/);
    assert.match(html, /There is a/);

    const css = await fetch(`${api.url}/deck.css`);
    assert.equal(css.status, 200);
    const js = await fetch(`${api.url}/deck.js`);
    assert.equal(js.status, 200);

    const anonymous = await fetch(`${api.url}/api/deck/bootstrap`);
    assert.equal(anonymous.status, 200);
    const anonymousBody = await anonymous.json();
    assert.equal(anonymousBody.hostLabel, 'test-deck-host');
    assert.equal(anonymousBody.ownerToken, null);
    assert.equal(anonymousBody.tokenPolicy, 'same-origin-only');
    assert.equal(anonymousBody.ui, '/');

    const origin = new URL(api.url).origin;
    const boot = await fetch(`${api.url}/api/deck/bootstrap`, {
      headers: { origin, 'sec-fetch-site': 'same-origin' },
    });
    assert.equal(boot.status, 200);
    const body = await boot.json();
    assert.equal(body.ownerToken, OWNER_TOKEN);
    assert.equal(body.tokenPolicy, 'same-origin-only');

    // Chrome often omits Origin on same-origin GET — still disclose.
    const chromeLike = await fetch(`${api.url}/api/deck/bootstrap`, {
      headers: { 'sec-fetch-site': 'same-origin' },
    });
    assert.equal(chromeLike.status, 200);
    assert.equal((await chromeLike.json()).ownerToken, OWNER_TOKEN);
  } finally {
    await api.close();
  }
});

test('advisory chat blocks owner-only and Vale Prime; allows public specialist only', async () => {
  const api = await startFunctionalApi();
  try {
    const blocked = await request(api, '/api/chat?agent=miss-vale-prime', { method: 'POST', body: 'hello Titan' });
    assert.equal(blocked.status, 403);
    assert.deepEqual(blocked.body, { error: 'agent not available for advisory chat' });

    const nyxBlocked = await request(api, '/api/chat?agent=nyx', { method: 'POST', body: 'hello Titan' });
    assert.equal(nyxBlocked.status, 403);

    const allowed = await request(api, '/api/chat?agent=agent-vale', { method: 'POST', body: 'hello Titan' });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.agentId, 'agent-vale');
  } finally {
    await api.close();
  }
});

test('functional API exposes health, operational team, durable command result, and mission retrieval', async () => {
  const api = await startFunctionalApi();
  try {
    const health = await request(api, '/health');
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, {
      ready: true,
      enabledAgents: 28,
      recovery: { recovered: 1, blocked: 0, corrupt: 0, healed: 0 },
    });

    const team = await request(api, '/api/team');
    assert.equal(team.status, 200);
    assert.equal(team.body.enabledAgents, 28);
    assert.equal(team.body.agents.length, 28);
    assert.ok(team.body.agents.every(({ enabled, operational, executorId }) => enabled && operational && typeof executorId === 'string'));
    const byId = Object.fromEntries(team.body.agents.map((a) => [a.id, a.executorId]));
    assert.equal(byId.loom, 'resource-commander');
    assert.equal(byId.echo, 'resonance-signal-monitor');
    assert.equal(byId.caretaker, 'fleet-health-runner');
    assert.equal(byId.qra_sentinel, 'output-governor');

    const command = await request(api, '/api/commands', { method: 'POST', body: 'test all of Titan' });
    assert.equal(command.status, 200);
    assert.equal(command.body.mission.status, 'completed');
    assert.equal(command.body.tests.failed, 0);

    const mission = await request(api, `/api/missions/${command.body.mission.id}`);
    assert.equal(mission.status, 200);
    assert.equal(mission.body.mission.id, command.body.mission.id);

    const advisoryExecution = await request(api, '/api/chat?agent=nyx', { method: 'POST', body: 'test Titan' });
    assert.equal(advisoryExecution.status, 403);
    assert.deepEqual(advisoryExecution.body, { error: 'agent not available for advisory chat' });

    const publicExecutionViaChat = await request(api, '/api/chat?agent=agent-vale', { method: 'POST', body: 'test Titan' });
    assert.equal(publicExecutionViaChat.status, 409);
    assert.deepEqual(publicExecutionViaChat.body, { error: 'execution request must use /api/commands' });
  } finally {
    await api.close();
  }
});

test('public health exposes recovery categories and counts without mission identifiers or failure details', async () => {
  const api = await startFunctionalApi({
    recovery: {
      recovered: ['mission-public-secret'],
      blocked: [{ missionId: 'mission-blocked-secret', revision: 4, detail: 'private host detail' }],
      corrupt: [{ missionId: 'mission-corrupt-secret', reason: 'private filesystem detail' }],
    },
  });
  try {
    const unauthenticated = await fetch(`${api.url}/health`);
    assert.equal(unauthenticated.status, 401);
    const health = await request(api, '/health');
    assert.equal(health.status, 200);
    assert.deepEqual(health.body.recovery, { recovered: 1, blocked: 1, corrupt: 1, healed: 0 });
    assert.doesNotMatch(JSON.stringify(health.body), /mission-public-secret|mission-blocked-secret|mission-corrupt-secret|private host detail|private filesystem detail/);
  } finally {
    await api.close();
  }
});

test('every profile must bind loopback; public commands and missions fail closed without a bearer', async () => {
  const runtime = createAgentRuntime({ complete: async () => ({ content: 'nope' }) });
  const publicApi = createTitanApi({
    runtime,
    profile: 'public',
    orchestrator: createOrchestrator(),
    team: fleetRegistry,
    recovery: { recovered: [], blocked: [], corrupt: [] },
  });
  await assert.rejects(
    () => publicApi.listen({ host: '0.0.0.0', port: 0 }),
    /must bind to loopback/,
  );
  await publicApi.listen({ host: '127.0.0.1', port: 0 });
  try {
    const command = await fetch(`${publicApi.url}/api/commands`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: 'test all of Titan',
    });
    const mission = await fetch(`${publicApi.url}/api/missions/mission-x`);
    const health = await fetch(`${publicApi.url}/health`);
    assert.deepEqual([command.status, mission.status, health.status], [401, 401, 401]);
  } finally {
    await publicApi.close();
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
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'titan-functional-startup-'));
  const root = join(repositoryRoot, 'workspace', 'titan');
  await saveMission({
    root,
    mission: createMission({ id: 'mission-startup-recovery', intent: 'test all of Titan', clock: () => '2026-08-23T12:00:00.000Z' }),
  });
  const api = await createTitanService({
    environment: { TITAN_API_BEARER_TOKEN: OWNER_TOKEN, OLLAMA_BASE_URL: 'http://127.0.0.1:11434', OLLAMA_MODEL: 'test-model' },
    repositoryRoot,
  });
  await api.listen({ host: '127.0.0.1', port: 0 });
  try {
    assert.equal((await request(api, '/health')).body.recovery.recovered, 1);
    const record = await loadMission({ root, missionId: 'mission-startup-recovery' });
    assert.equal(record.mission.status, 'blocked');
    assert.equal(record.mission.signals.at(-1).detail, 'interrupted execution requires operator retry');
  } finally {
    await api.close();
  }
});

test('startup composition rejects absolute and traversal workspace roots', async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), 'titan-functional-workspace-'));
  for (const TITAN_WORKSPACE_ROOT of [join(tmpdir(), 'titan-escape'), '../titan-escape', 'workspace/../titan-escape']) {
    await assert.rejects(
      () => createTitanService({
        environment: { TITAN_API_BEARER_TOKEN: OWNER_TOKEN, TITAN_WORKSPACE_ROOT, OLLAMA_BASE_URL: 'http://127.0.0.1:11434', OLLAMA_MODEL: 'test-model' },
        repositoryRoot,
      }),
      /TITAN_WORKSPACE_ROOT must stay within repository workspace/,
    );
  }
});

test('command and chat routes require UTF-8 text/plain bodies', async () => {
  const api = await startFunctionalApi();
  try {
    const unsupported = await fetch(`${api.url}/api/commands`, {
      method: 'POST', headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'content-type': 'application/json' }, body: '{}',
    });
    assert.deepEqual({ status: unsupported.status, body: await unsupported.json() }, { status: 415, body: { error: 'unsupported media type' } });

    const missing = await fetch(`${api.url}/api/chat?agent=agent-vale`, {
      method: 'POST', headers: { authorization: `Bearer ${OWNER_TOKEN}` }, body: new Uint8Array([0x68, 0x69]),
    });
    assert.deepEqual({ status: missing.status, body: await missing.json() }, { status: 415, body: { error: 'unsupported media type' } });

    const malformed = await fetch(`${api.url}/api/commands`, {
      method: 'POST', headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'content-type': 'text/plain; charset=utf-8' }, body: new Uint8Array([0xc3, 0x28]),
    });
    assert.deepEqual({ status: malformed.status, body: await malformed.json() }, { status: 400, body: { error: 'malformed UTF-8 request body' } });
  } finally {
    await api.close();
  }
});

test('API returns a stable generic response instead of exposing unexpected internal errors', async () => {
  const errors = [];
  const api = await startFunctionalApi({
    orchestrator: {
      async execute() { throw new Error('secret filesystem path C:\\private\\mission.json'); },
      async getMission() { throw new Error('not used'); },
    },
    logger: { error(...args) { errors.push(args); } },
  });
  try {
    const response = await request(api, '/api/commands', { method: 'POST', body: 'test all of Titan' });
    assert.deepEqual(response, { status: 500, body: { error: 'internal server error' } });
    assert.equal(errors.length, 1);
    assert.equal(errors[0][1].message, 'secret filesystem path C:\\private\\mission.json');
  } finally {
    await api.close();
  }
});
