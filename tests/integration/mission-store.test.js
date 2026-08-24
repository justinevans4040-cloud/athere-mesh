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

for (const [label, partialMetadata] of [['empty', ''], ['truncated', '{"version":2']]) {
  test(`${label === 'empty' ? 'an' : 'a'} ${label} prepared-lock crash never publishes a canonical owner`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'titan-mission-'));
    const missionId = `mission-prepared-${label}`;
    const store = createMissionStore({
      filesystem: {
        ...filesystem,
        async writeFile(file, data, options) {
          if (String(file).includes('.lock.candidate-')) {
            await filesystem.writeFile(file, partialMetadata, options);
            throw transientError('EIO');
          }
          return filesystem.writeFile(file, data, options);
        },
      },
    });

    await assert.rejects(
      () => store.saveMission({ root, mission: createMission({ id: missionId, intent: 'Publish complete ownership only' }) }),
      (error) => error.code === 'EIO',
    );
    await assert.rejects(
      () => filesystem.readFile(join(root, 'missions', `.${missionId}.lock`), 'utf8'),
      (error) => error.code === 'ENOENT',
    );
    assert.deepEqual(await readdir(join(root, 'missions')), []);
  });
}

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

test('mission store retries only transient lock-publication and rename sharing failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-mission-'));
  let lockPublicationAttempts = 0;
  let renameAttempts = 0;
  let retryDelays = 0;
  const store = createMissionStore({
    filesystem: {
      ...filesystem,
      async link(...args) {
        lockPublicationAttempts += 1;
        if (lockPublicationAttempts === 1) throw transientError('EPERM');
        return filesystem.link(...args);
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
  assert.equal(lockPublicationAttempts, 2);
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

test('mission store rejects a successful write when lock cleanup fails and still attempts every cleanup step', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-mission-'));
  const cleanupSteps = [];
  const store = createMissionStore({
    filesystem: {
      ...filesystem,
      async open(...args) {
        const handle = await filesystem.open(...args);
        return {
          async close() {
            cleanupSteps.push('close');
            await handle.close();
          },
        };
      },
      async rm(file, ...args) {
        cleanupSteps.push(String(file).endsWith('.lock') ? 'lock' : String(file).includes('.lock.candidate-') ? 'candidate' : 'temporary');
        if (String(file).endsWith('.lock')) throw transientError('EIO');
        return filesystem.rm(file, ...args);
      },
    },
  });
  await assert.rejects(
    () => store.saveMission({ root, mission: createMission({ id: 'mission-lock-cleanup', intent: 'Never report stale locks as success' }) }),
    (error) => error instanceof AggregateError
      && error.message === 'mission cleanup failed'
      && error.errors.length === 1
      && error.errors[0].cause?.code === 'EIO',
  );
  assert.deepEqual(cleanupSteps, ['candidate', 'temporary', 'close', 'lock']);
});

test('mission store preserves a primary write failure while aggregating cleanup failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-mission-'));
  const store = createMissionStore({
    filesystem: {
      ...filesystem,
      async rename() { throw transientError('EIO'); },
      async rm(file, ...args) {
        if (String(file).endsWith('.lock')) throw transientError('EPERM');
        return filesystem.rm(file, ...args);
      },
    },
  });
  await assert.rejects(
    () => store.saveMission({ root, mission: createMission({ id: 'mission-primary-failure', intent: 'Retain the primary error' }) }),
    (error) => error instanceof AggregateError
      && error.message === 'mission write and cleanup failed'
      && error.errors[0].code === 'EIO'
      && error.errors[1] instanceof AggregateError
      && error.errors[1].errors[0].cause?.code === 'EPERM',
  );
});

test('mission store tolerates only absent cleanup files and already-closed handles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-mission-'));
  const store = createMissionStore({
    filesystem: {
      ...filesystem,
      async open(...args) {
        const handle = await filesystem.open(...args);
        return {
          async close() {
            await handle.close();
            throw transientError('EBADF');
          },
        };
      },
      async rm(file, ...args) {
        await filesystem.rm(file, ...args);
        throw transientError('ENOENT');
      },
    },
  });
  assert.equal(
    (await store.saveMission({ root, mission: createMission({ id: 'mission-expected-cleanup', intent: 'Permit only expected cleanup absence' }) })).revision,
    1,
  );
});

test('mission cleanup never removes a successor lock owned by another token', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-mission-'));
  const missionId = 'mission-successor-lock';
  const successor = `${JSON.stringify({
    version: 1,
    owner: { hostname: 'titan-host', pid: 7777, token: 'successor-owner-token-0123456789' },
    lease: { acquiredAt: '2026-08-23T12:00:00.000Z', expiresAt: '2026-08-23T12:00:30.000Z' },
  })}\n`;
  const store = createMissionStore({
    hostname: 'titan-host',
    pid: 7001,
    clock: clock('2026-08-23T12:00:00.000Z'),
    tokenFactory: () => 'original-owner-token-0123456789',
    filesystem: {
      ...filesystem,
      async rename(from, to) {
        await filesystem.rename(from, to);
        if (String(to).endsWith(`${missionId}.json`)) {
          await filesystem.writeFile(join(root, 'missions', `.${missionId}.lock`), successor, 'utf8');
        }
      },
    },
  });

  await assert.rejects(
    () => store.saveMission({ root, mission: createMission({ id: missionId, intent: 'Preserve successor ownership' }) }),
    (error) => error instanceof AggregateError
      && error.message === 'mission cleanup failed'
      && error.errors[0].cause?.message === 'mission lock ownership changed',
  );
  assert.equal(await filesystem.readFile(join(root, 'missions', `.${missionId}.lock`), 'utf8'), successor);
});

test('two stale-lock reclaimers cannot displace the first published successor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-mission-'));
  const missionId = 'mission-two-reclaimers';
  const lockPath = join(root, 'missions', `.${missionId}.lock`);
  const staleToken = 'dead-owner-token-0123456789abcdef';
  const accepted = createMission({ id: missionId, intent: 'Serialize stale takeover' });
  await saveMission({ root, mission: accepted });
  await filesystem.writeFile(lockPath, `${JSON.stringify({
    version: 1,
    owner: { hostname: 'titan-host', pid: 40404, token: staleToken },
    lease: { acquiredAt: '2026-08-23T12:00:00.000Z', expiresAt: '2026-08-23T12:00:30.000Z' },
  })}\n`, 'utf8');

  let staleReads = 0;
  let releaseFourthStaleRead;
  const fourthStaleRead = new Promise((resolve) => { releaseFourthStaleRead = resolve; });
  let staleLivenessChecks = 0;
  let releaseSecondStaleCheck;
  const secondStaleCheck = new Promise((resolve) => { releaseSecondStaleCheck = resolve; });
  let staleRenames = 0;
  let announceSuccessor;
  const successorPublished = new Promise((resolve) => { announceSuccessor = resolve; });
  let announceOwnerHolding;
  const ownerHolding = new Promise((resolve) => { announceOwnerHolding = resolve; });
  let releaseOwner;
  const ownerRelease = new Promise((resolve) => { releaseOwner = resolve; });
  let snapshotPaused = false;

  const interleavingFilesystem = {
    ...filesystem,
    async readFile(file, ...args) {
      if (String(file) === join(root, 'missions', `${missionId}.json`) && !snapshotPaused) {
        snapshotPaused = true;
        announceOwnerHolding();
        await ownerRelease;
      }
      const content = await filesystem.readFile(file, ...args);
      if (String(file) === lockPath && String(content).includes(staleToken)) {
        staleReads += 1;
        if (staleReads === 3) await fourthStaleRead;
        if (staleReads === 4) releaseFourthStaleRead();
      }
      return content;
    },
    async writeFile(file, data, ...args) {
      const result = await filesystem.writeFile(file, data, ...args);
      if (String(file) === lockPath && !String(data).includes(staleToken)) announceSuccessor();
      return result;
    },
    async link(existingPath, newPath) {
      const result = await filesystem.link(existingPath, newPath);
      if (String(newPath) === lockPath) announceSuccessor();
      return result;
    },
    async rename(from, to) {
      if (String(from) === lockPath && String(to).includes('.stale-')) {
        staleRenames += 1;
        if (staleRenames === 2) await successorPublished;
      }
      return filesystem.rename(from, to);
    },
  };
  const common = {
    filesystem: interleavingFilesystem,
    hostname: 'titan-host',
    clock: clock('2026-08-23T12:01:00.000Z'),
    isProcessAlive: async (ownerPid) => {
      if (ownerPid !== 40404) return true;
      staleLivenessChecks += 1;
      if (staleLivenessChecks === 1) await secondStaleCheck;
      if (staleLivenessChecks === 2) releaseSecondStaleCheck();
      return false;
    },
  };
  const firstStore = createMissionStore({ ...common, pid: 7001, tokenFactory: () => 'first-successor-token-0123456789' });
  const secondStore = createMissionStore({ ...common, pid: 7002, tokenFactory: () => 'second-successor-token-0123456789' });
  const running = transitionMission(accepted, { type: 'running', agent: 'rune' });

  const firstAttempt = firstStore.saveMission({ root, mission: running, expectedRevision: 1 }).then(
    (record) => ({ record }),
    (error) => ({ error }),
  );
  const secondAttempt = secondStore.saveMission({ root, mission: running, expectedRevision: 1 }).then(
    (record) => ({ record }),
    (error) => ({ error }),
  );
  await ownerHolding;
  const earlyOutcome = await Promise.race([firstAttempt, secondAttempt]);
  let publishedContent;
  try {
    publishedContent = await filesystem.readFile(lockPath, 'utf8');
  } catch (error) {
    publishedContent = error;
  } finally {
    releaseOwner();
  }
  const outcomes = await Promise.all([firstAttempt, secondAttempt]);

  assert.equal(earlyOutcome.error?.message, 'mission write already in progress');
  assert.equal(outcomes.filter(({ record }) => record?.revision === 2).length, 1);
  assert.equal(staleLivenessChecks, 3);
  assert.equal(staleRenames, 1);
  assert.match(String(publishedContent), /first-successor-token|second-successor-token/);
  assert.equal((await firstStore.loadMission({ root, missionId })).revision, 2);
});

for (const [label, priorIdentity, currentIdentity] of [
  ['prior Linux boot', { bootId: 'boot-old', processStartTicks: '100' }, { bootId: 'boot-current', processStartTicks: '100', alive: true }],
  ['reused Linux PID', { bootId: 'boot-current', processStartTicks: '100' }, { bootId: 'boot-current', processStartTicks: '200', alive: true }],
]) {
  test(`mission store reclaims an owner from a ${label}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'titan-mission-'));
    const missionId = `mission-identity-${label.replaceAll(' ', '-').toLowerCase()}`;
    await saveMission({ root, mission: createMission({ id: missionId, intent: 'Bind lock to process identity' }) });
    await filesystem.writeFile(join(root, 'missions', `.${missionId}.lock`), `${JSON.stringify({
      version: 2,
      owner: {
        hostname: 'titan-host',
        pid: 50505,
        token: 'prior-owner-token-0123456789abcdef',
        ...priorIdentity,
      },
      lease: { acquiredAt: '2026-08-23T12:00:00.000Z', expiresAt: '2026-08-23T12:00:30.000Z' },
    })}\n`, 'utf8');
    const store = createMissionStore({
      hostname: 'titan-host',
      pid: 7001,
      tokenFactory: () => 'current-owner-token-0123456789',
      readProcessIdentity: async () => currentIdentity,
      isProcessAlive: async () => true,
    });

    assert.equal((await store.saveMission({ root, mission: createMission({ id: missionId, intent: 'Bind lock to process identity' }), expectedRevision: 1 })).revision, 2);
  });
}

test('mission store refuses a live owner with the same Linux boot and process start', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-mission-'));
  const missionId = 'mission-identity-live-owner';
  await saveMission({ root, mission: createMission({ id: missionId, intent: 'Preserve a live owner' }) });
  const lockPath = join(root, 'missions', `.${missionId}.lock`);
  const activeMetadata = `${JSON.stringify({
    version: 2,
    owner: {
      hostname: 'titan-host',
      pid: 50505,
      token: 'active-owner-token-0123456789abcdef',
      bootId: 'boot-current',
      processStartTicks: '200',
    },
    lease: { acquiredAt: '2026-08-23T12:00:00.000Z', expiresAt: '2026-08-23T12:00:30.000Z' },
  })}\n`;
  await filesystem.writeFile(lockPath, activeMetadata, 'utf8');
  const store = createMissionStore({
    hostname: 'titan-host',
    pid: 7001,
    readProcessIdentity: async () => ({ bootId: 'boot-current', processStartTicks: '200', alive: true }),
  });

  await assert.rejects(
    () => store.saveMission({ root, mission: createMission({ id: missionId, intent: 'Preserve a live owner' }), expectedRevision: 1 }),
    /mission write already in progress/,
  );
  assert.equal(await filesystem.readFile(lockPath, 'utf8'), activeMetadata);
});
