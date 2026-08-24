import test from 'node:test';
import assert from 'node:assert/strict';
import { runFunctionalTeamSmoke } from '../../scripts/smoke-functional-team.js';

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
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const pathname = new URL(url).pathname;
    if (pathname === '/health') return response(200, { ready: true, enabledAgents: 6, recovery: { recovered: [], blocked: [], corrupt: [] } });
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
      tests: { tests: 12, passed: 12, failed: 0, skipped: 0 },
    });
    if (pathname === `/api/missions/${missionId}`) return response(200, {
      revision: 3,
      mission: { id: missionId, status: 'completed', proof },
    });
    throw new Error(`unexpected request: ${url}`);
  };

  const evidence = await runFunctionalTeamSmoke({
    baseUrl: 'http://127.0.0.1:5050',
    fetchImpl,
    write: (line) => writes.push(line),
  });

  assert.deepEqual(calls.map(({ url }) => new URL(url).pathname), [
    '/health', '/api/team', '/api/commands', `/api/missions/${missionId}`,
  ]);
  assert.deepEqual(calls[2].options, {
    method: 'POST',
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body: 'test all of Titan',
  });
  assert.equal(evidence.missionId, missionId);
  assert.equal(evidence.proof.path, proof.path);
  assert.equal(evidence.proof.sha256, proof.sha256);
  assert.equal(evidence.tests.failed, 0);
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0]), evidence);
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
    () => runFunctionalTeamSmoke({ baseUrl: 'http://127.0.0.1:5050', fetchImpl, write() {} }),
    /SHA-256/,
  );
});
