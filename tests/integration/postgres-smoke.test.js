import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresClient } from '../../packages/postgres/src/postgres-client.js';
import { runPostgresSmoke } from '../../packages/postgres/src/postgres-smoke.js';

test('Postgres smoke proves a mission round trip and reports server identity', async () => {
  const client = await createPostgresClient({ mode: 'embedded' });
  const proof = await runPostgresSmoke({ client, missionId: 'smoke-fixed', at: '2026-08-23T21:00:00.000Z' });
  assert.equal(proof.ok, true);
  assert.equal(proof.missionId, 'smoke-fixed');
  assert.equal(proof.revision, 1);
  assert.equal(proof.status, 'running');
  assert.match(proof.server, /^PostgreSQL /);
  await client.close();
});
