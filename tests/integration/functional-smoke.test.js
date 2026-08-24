import test from 'node:test';
import assert from 'node:assert/strict';
import { runFunctionalTeamSmoke } from '../../scripts/smoke-functional-team.js';

const OWNER_TOKEN = 'test-owner-token-0123456789abcdef0123456789';

function response(status, body) {
  return {
    status,
    async json() { return body; },
  };
}

test('functional smoke proves health, team, normal-language command, and stored proof', async () => {
  const calls = [];
  const writes = [];
  const missionId = 'mission-smoke-1';
  const proof = { path: `proofs/${missionId}.json`, sha256: 'a'.repeat(64), verified: true };
  const tests = { tests: 12, passed: 12, failed: 0, skipped: 0 };
  const result = {
    tests,
    proofSha256: proof.sha256,
    agentEvidence: [
      { agent: 'nyx', executor: 'repository-inspector', result: { sourceFilesOnDisk: 12, testFilesOnDisk: 12 } },
      { agent: 'rune', executor: 'node-test-runner', result: { command: 'node --test', exitCode: 0, ...tests } },
    ],
  };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const pathname = new URL(url).pathname;
    if (pathname === '/health') return response(200, { ready: true, enabledAgents: 6, recovery: { recovered: 0, blocked: 0, corrupt: 0 } });
    if (pathname === '/api/team') return response(200, {
      enabledAgents: 6,
      agents: [
        { id: 'miss-vale-prime', operational: true },
        { id: 'agent-vale', operational: true },
        { id: 'nyx', operational: true },
        { id: 'rune', operational: true },
        { id: 'qra_emerge_audit', operational: true },
        { id: 'qra_recovery_driver', operational: true },
      ],
    });
    if (pathname === '/api/commands') return response(200, {
      mission: { id: missionId, status: 'completed', proof },
      tests,
    });
    if (pathname === `/api/missions/${missionId}`) return response(200, {
      revision: 5,
      mission: { id: missionId, status: 'completed', proof, result },
    });
    throw new Error(`unexpected request: ${url}`);
  };

  const evidence = await runFunctionalTeamSmoke({
    baseUrl: 'http://127.0.0.1:5050',
    authToken: OWNER_TOKEN,
    fetchImpl,
    write: (line) => writes.push(line),
  });

  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
    '/health', '/api/team', '/api/commands', `/api/missions/${missionId}`,
  ]);
  assert.ok(calls.every(({ options }) => options.signal instanceof AbortSignal));
  assert.equal(calls[2].options.method, 'POST');
  assert.deepEqual(calls[2].options.headers, {
    authorization: `Bearer ${OWNER_TOKEN}`,
    'content-type': 'text/plain; charset=utf-8',
  });
  assert.deepEqual(calls[3].options.headers, {
    authorization: `Bearer ${OWNER_TOKEN}`,
  });
  assert.equal(calls[2].options.body, 'test all of Titan');
  assert.equal(evidence.missionId, missionId);
  assert.equal(evidence.proof.path, proof.path);
  assert.equal(evidence.proof.sha256, proof.sha256);
  assert.equal(evidence.tests.failed, 0);
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0]), evidence);
});

test('functional smoke rejects non-ASCII and overlong bearer credentials before network access', async () => {
  for (const invalidToken of ['é'.repeat(32), 'x'.repeat(513)]) {
    let fetchCalls = 0;
    await assert.rejects(
      () => runFunctionalTeamSmoke({
        baseUrl: 'http://127.0.0.1:5050',
        authToken: invalidToken,
        async fetchImpl() { fetchCalls += 1; throw new Error('network must not be reached'); },
        write() {},
      }),
      /strong bearer credential/,
    );
    assert.equal(fetchCalls, 0);
  }
});

test('functional smoke refuses unverified or malformed stored proof evidence', async () => {
  const missionId = 'mission-smoke-bad-proof';
  const fetchImpl = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/health') return response(200, { ready: true, enabledAgents: 6 });
    if (pathname === '/api/team') return response(200, {
      enabledAgents: 6,
      agents: [
        { id: 'miss-vale-prime', operational: true },
        { id: 'agent-vale', operational: true },
        { id: 'nyx', operational: true },
        { id: 'rune', operational: true },
        { id: 'qra_emerge_audit', operational: true },
        { id: 'qra_recovery_driver', operational: true },
      ],
    });
    if (pathname === '/api/commands') return response(200, {
      mission: { id: missionId, status: 'completed', proof: { path: `proofs/${missionId}.json`, sha256: 'A'.repeat(64), verified: true } },
      tests: { tests: 1, passed: 1, failed: 0, skipped: 0 },
    });
    if (pathname === `/api/missions/${missionId}`) return response(200, {
      mission: { id: missionId, status: 'completed', proof: { path: `proofs/${missionId}.json`, sha256: 'A'.repeat(64), verified: true } },
    });
    throw new Error(`unexpected request: ${url}`);
  };

  await assert.rejects(
    () => runFunctionalTeamSmoke({ baseUrl: 'http://127.0.0.1:5050', authToken: OWNER_TOKEN, fetchImpl, write() {} }),
    /SHA-256/,
  );
});

test('functional smoke bounds stalled requests, aborts them, and prints no evidence', async () => {
  const writes = [];
  let signal;
  const fetchImpl = async (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  };

  await assert.rejects(
    () => runFunctionalTeamSmoke({
      baseUrl: 'http://127.0.0.1:5050',
      authToken: OWNER_TOKEN,
      fetchImpl,
      write: (line) => writes.push(line),
      quickTimeoutMs: 10,
      commandTimeoutMs: 20,
    }),
    /^Error: health request timed out$/,
  );
  assert.equal(signal.aborted, true);
  assert.deepEqual(writes, []);
});

test('functional smoke bounds a stalled JSON body with the same contextual deadline', async () => {
  const writes = [];
  let signal;
  const fetchImpl = async (_url, options) => {
    signal = options.signal;
    return {
      status: 200,
      async json() { return new Promise(() => {}); },
    };
  };
  const result = await Promise.race([
    runFunctionalTeamSmoke({
      baseUrl: 'http://127.0.0.1:5050',
      authToken: OWNER_TOKEN,
      fetchImpl,
      write: (line) => writes.push(line),
      quickTimeoutMs: 10,
      commandTimeoutMs: 20,
    }).then(
      () => ({ error: undefined }),
      (error) => ({ error }),
    ),
    new Promise((resolve) => setTimeout(() => resolve({ guardExpired: true }), 50)),
  ]);

  assert.equal(result.guardExpired, undefined);
  assert.match(result.error?.message ?? '', /^health request timed out$/);
  assert.equal(signal.aborted, true);
  assert.deepEqual(writes, []);
});
