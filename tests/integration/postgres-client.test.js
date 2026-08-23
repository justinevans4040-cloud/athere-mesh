import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgresClient } from '../../packages/postgres/src/postgres-client.js';

test('embedded Postgres client executes the same query contract used on Ubuntu', async () => {
  const client = await createPostgresClient({ mode: 'embedded' });
  const result = await client.query('SELECT $1::text AS value', ['titan']);
  assert.deepEqual(result.rows, [{ value: 'titan' }]);
  await client.close();
});

test('live Postgres mode refuses to guess a connection target', async () => {
  await assert.rejects(() => createPostgresClient({ mode: 'live' }), /DATABASE_URL/i);
});

test('unknown Postgres modes fail explicitly', async () => {
  await assert.rejects(() => createPostgresClient({ mode: 'invented' }), /Postgres mode/i);
});
