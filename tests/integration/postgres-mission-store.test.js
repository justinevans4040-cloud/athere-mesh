import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createMission, transitionMission } from '../../packages/contracts/src/mission.js';
import { createPostgresMissionStore } from '../../packages/postgres/src/postgres-mission-store.js';

const clock = (value) => () => value;

test('Postgres store persists a mission and its complete signal history', async () => {
  const db = new PGlite();
  const store = await createPostgresMissionStore({ db });
  const accepted = createMission({ id: 'pg-1', intent: 'Persist in Postgres', clock: clock('2026-08-23T10:00:00.000Z') });
  const running = transitionMission(accepted, { type: 'running', agent: 'jarvis' }, { clock: clock('2026-08-23T10:01:00.000Z') });
  assert.equal((await store.save({ mission: running })).revision, 1);
  assert.deepEqual(await store.load({ missionId: 'pg-1' }), { revision: 1, mission: running });
  await db.close();
});

test('Postgres store rejects a stale revision instead of losing a worker update', async () => {
  const db = new PGlite();
  const store = await createPostgresMissionStore({ db });
  const accepted = createMission({ id: 'pg-2', intent: 'Protect concurrent writes', clock: clock('2026-08-23T10:00:00.000Z') });
  await store.save({ mission: accepted });
  const running = transitionMission(accepted, { type: 'running', agent: 'jarvis' }, { clock: clock('2026-08-23T10:01:00.000Z') });
  assert.equal((await store.save({ mission: running, expectedRevision: 1 })).revision, 2);
  await assert.rejects(() => store.save({ mission: accepted, expectedRevision: 1 }), /revision conflict/i);
  await db.close();
});

test('Postgres store rejects unsafe mission ids and missing records', async () => {
  const db = new PGlite();
  const store = await createPostgresMissionStore({ db });
  await assert.rejects(() => store.load({ missionId: '../escape' }), /mission id/i);
  await assert.rejects(() => store.load({ missionId: 'missing' }), /not found/i);
  await db.close();
});
