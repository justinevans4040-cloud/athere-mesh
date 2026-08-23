import { randomUUID } from 'node:crypto';
import { createPostgresClient } from '../packages/postgres/src/postgres-client.js';
import { runPostgresSmoke } from '../packages/postgres/src/postgres-smoke.js';

const mode = process.env.DATABASE_URL ? 'live' : 'embedded';
const client = await createPostgresClient({ mode, databaseUrl: process.env.DATABASE_URL });
try {
  const proof = await runPostgresSmoke({ client, missionId: `smoke-${randomUUID()}` });
  process.stdout.write(`${JSON.stringify({ ...proof, mode })}\n`);
} finally {
  await client.close();
}
