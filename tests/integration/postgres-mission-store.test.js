import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createMission, transitionMission } from '../../packages/contracts/src/mission.js';
import { createPostgresMissionStore } from '../../packages/postgres/src/postgres-mission-store.js';
import { inspectRecovery, recoverInterruptedMissions } from '../../packages/recovery/src/recovery-coordinator.js';

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

test('QRA recovery discovers and blocks interrupted missions directly from Postgres', async () => {
  const db = new PGlite();
  const store = await createPostgresMissionStore({ db });
  const accepted = createMission({ id: 'pg-recover-accepted', intent: 'Resume accepted work', clock: clock('2026-08-23T10:00:00.000Z') });
  const runningBase = createMission({ id: 'pg-recover-running', intent: 'Resume running work', clock: clock('2026-08-23T10:00:00.000Z') });
  const running = transitionMission(runningBase, { type: 'running', agent: 'rune' }, { clock: clock('2026-08-23T10:01:00.000Z') });
  const doneBase = createMission({ id: 'pg-recover-done', intent: 'Ignore completed work', clock: clock('2026-08-23T10:00:00.000Z') });
  const doneRunning = transitionMission(doneBase, { type: 'running', agent: 'rune' }, { clock: clock('2026-08-23T10:01:00.000Z') });
  const done = transitionMission(doneRunning, {
    type: 'completed',
    agent: 'qra_emerge_audit',
    proof: { verified: true, path: 'proofs/pg-recover-done.json', sha256: 'a'.repeat(64) },
  }, { clock: clock('2026-08-23T10:02:00.000Z') });

  await store.save({ mission: accepted });
  await store.save({ mission: running });
  await store.save({ mission: done });

  assert.deepEqual(await inspectRecovery({ root: 'unused-for-postgres', missionStore: store }), {
    resumable: [
      { missionId: 'pg-recover-accepted', revision: 1, action: 'resume', assignedTo: 'qra_recovery_driver' },
      { missionId: 'pg-recover-running', revision: 1, action: 'resume', assignedTo: 'qra_recovery_driver' },
    ],
    blocked: [],
    corrupt: [],
  });

  assert.deepEqual(
    await recoverInterruptedMissions({ root: 'unused-for-postgres', missionStore: store, clock: clock('2026-08-23T10:03:00.000Z') }),
    { recovered: ['pg-recover-accepted', 'pg-recover-running'], blocked: [], corrupt: [] },
  );

  assert.equal((await store.load({ missionId: 'pg-recover-accepted' })).mission.status, 'blocked');
  assert.equal((await store.load({ missionId: 'pg-recover-running' })).mission.status, 'blocked');
  assert.equal((await store.load({ missionId: 'pg-recover-done' })).mission.status, 'completed');
  await db.close();
});
