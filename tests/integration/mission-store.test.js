import test from 'node:test';
import assert from 'node:assert/strict';
import * as filesystem from 'node:fs/promises';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMission, transitionMission } from '../../packages/contracts/src/mission.js';
import { createMissionStore, loadMission, saveMission } from '../../packages/mission/src/mission-store.js';

const clock = (value) => () => value;

test('mission snapshot survives restart with its revision and signals intact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-mission-'));
  const accepted = createMission({ id: 'mission-1', intent: 'Check every fleet cluster', clock: clock('2026-08-23T12:00:00.000Z') });
  const first = await saveMission({ root, mission: accepted });
  assert.equal(first.revision, 1);

  const loaded = await loadMission({ root, missionId: 'mission-1' });
  assert.equal(loaded.revision, 1);
  assert.deepEqual(loaded.mission, accepted);
});

test('mission writes are atomic and leave no temporary siblings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-mission-'));
  const mission = createMission({ id: 'mission-2', intent: 'Persist safely', clock: clock('2026-08-23T12:00:00.000Z') });
  await saveMission({ root, mission });
  assert.deepEqual(await readdir(join(root, 'missions')), ['mission-2.json']);
});

test('stale worker cannot overwrite a newer mission revision', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-mission-'));
  const accepted = createMission({ id: 'mission-3', intent: 'Coordinate workers', clock: clock('2026-08-23T12:00:00.000Z') });
  await saveMission({ root, mission: accepted });
  const running = transitionMission(accepted, { type: 'running', agent: 'jarvis' }, { clock: clock('2026-08-23T12:01:00.000Z') });
  const updated = await saveMission({ root, mission: running, expectedRevision: 1 });
  assert.equal(updated.revision, 2);
  await assert.rejects(
    () => saveMission({ root, mission: accepted, expectedRevision: 1 }),
    /revision conflict/i,
  );
});

test('mission store rejects unsafe ids and corrupted snapshots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-mission-'));
  await assert.rejects(() => loadMission({ root, missionId: '../escape' }), /mission id/i);
  await saveMission({ root, mission: createMission({ id: 'mission-4', intent: 'Detect corruption' }) });
  await writeFile(join(root, 'missions', 'mission-4.json'), '{not-json', 'utf8');
  await assert.rejects(() => loadMission({ root, missionId: 'mission-4' }), /corrupt mission snapshot/i);
});

function transientError(code) {
  const error = new Error(`simulated ${code}`);
  error.code = code;
  return error;
}

test('mission store retries only transient lock-open and rename sharing failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-mission-'));
  let lockOpenAttempts = 0;
  let renameAttempts = 0;
  let retryDelays = 0;
  const store = createMissionStore({
    filesystem: {
      ...filesystem,
      async open(file, flags, ...args) {
        if (flags === 'wx' && String(file).endsWith('.lock') && lockOpenAttempts++ === 0) throw transientError('EPERM');
        return filesystem.open(file, flags, ...args);
      },
      async rename(...args) {
        if (renameAttempts++ === 0) throw transientError('EPERM');
        return filesystem.rename(...args);
      },
    },
    retryDelay: async () => { retryDelays += 1; },
  });
  const record = await store.saveMission({
    root,
    mission: createMission({ id: 'mission-transient-sharing', intent: 'Persist through Windows sharing contention' }),
  });
  assert.equal(record.revision, 1);
  assert.equal(lockOpenAttempts, 2);
  assert.equal(renameAttempts, 2);
  assert.equal(retryDelays, 2);
  assert.equal((await store.loadMission({ root, missionId: 'mission-transient-sharing' })).revision, 1);
});

test('mission store does not retry non-transient filesystem failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-mission-'));
  let retryDelays = 0;
  const store = createMissionStore({
    filesystem: {
      ...filesystem,
      async rename() { throw transientError('EIO'); },
    },
    retryDelay: async () => { retryDelays += 1; },
  });
  await assert.rejects(
    () => store.saveMission({ root, mission: createMission({ id: 'mission-nontransient', intent: 'Preserve real disk errors' }) }),
    (error) => error.code === 'EIO',
  );
  assert.equal(retryDelays, 0);
});
