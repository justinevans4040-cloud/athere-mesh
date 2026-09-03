import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMission, transitionMission } from '../../packages/contracts/src/mission.js';
import { createMissionStore, saveMission } from '../../packages/mission/src/mission-store.js';
import { inspectRecovery, recoverInterruptedMissions } from '../../packages/recovery/src/recovery-coordinator.js';
import { loadMission } from '../../packages/mission/src/mission-store.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

const clock = (value) => () => value;

function lockMetadata({ pid, token, acquiredAt = '2026-08-23T10:00:00.000Z', expiresAt = '2026-08-23T10:00:30.000Z' }) {
  return `${JSON.stringify({
    version: 1,
    owner: { hostname: 'titan-host', pid, token },
    lease: { acquiredAt, expiresAt },
  })}\n`;
}

function deterministicMissionStore({ activePids = new Set() } = {}) {
  let tokenSequence = 0;
  return createMissionStore({
    hostname: 'titan-host',
    pid: 9001,
    clock: clock('2026-08-23T10:01:00.000Z'),
    tokenFactory: () => `current-owner-token-${++tokenSequence}-0123456789`,
    isProcessAlive: async (pid) => activePids.has(pid),
  });
}

test('startup recovery reclaims a demonstrably dead-owner lease and blocks the interrupted mission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-recovery-'));
  const missionId = 'mission-dead-owner-lock';
  await saveMission({ root, mission: createMission({ id: missionId, intent: 'Run Titan tests', clock: clock('2026-08-23T10:00:00.000Z') }) });
  const lockPath = join(root, 'missions', `.${missionId}.lock`);
  await writeFile(lockPath, lockMetadata({ pid: 40404, token: 'dead-owner-token-0123456789abcdef' }), 'utf8');
  const missionStore = deterministicMissionStore();

  assert.deepEqual(
    await recoverInterruptedMissions({ root, missionStore, clock: clock('2026-08-23T10:02:00.000Z') }),
    { recovered: [missionId], blocked: [], corrupt: [] },
  );
  const record = await missionStore.loadMission({ root, missionId });
  assert.equal(record.mission.status, 'blocked');
  assert.equal(record.mission.signals.at(-1).agent, 'qra_recovery_driver');
  await assert.rejects(() => readFile(lockPath, 'utf8'), (error) => error.code === 'ENOENT');
});

for (const [label, partialMetadata] of [
  ['empty', ''],
  ['truncated', '{"version":1,"owner":'],
]) {
  test(`startup recovery repairs a crash-point ${label} lock artifact`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'titan-recovery-'));
    const missionId = `mission-${label}-lock`;
    await saveMission({ root, mission: createMission({ id: missionId, intent: 'Run Titan tests', clock: clock('2026-08-23T10:00:00.000Z') }) });
    const lockPath = join(root, 'missions', `.${missionId}.lock`);
    await writeFile(lockPath, partialMetadata, 'utf8');
    const missionStore = deterministicMissionStore();

    assert.deepEqual(
      await recoverInterruptedMissions({ root, missionStore, clock: clock('2026-08-23T10:02:00.000Z') }),
      { recovered: [missionId], blocked: [], corrupt: [] },
    );
    assert.equal((await missionStore.loadMission({ root, missionId })).mission.status, 'blocked');
    await assert.rejects(() => readFile(lockPath, 'utf8'), (error) => error.code === 'ENOENT');
  });
}

test('startup recovery refuses to steal a genuinely active owner lease', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-recovery-'));
  const missionId = 'mission-active-owner-lock';
  await saveMission({ root, mission: createMission({ id: missionId, intent: 'Run Titan tests', clock: clock('2026-08-23T10:00:00.000Z') }) });
  const lockPath = join(root, 'missions', `.${missionId}.lock`);
  const activeMetadata = lockMetadata({ pid: 50505, token: 'active-owner-token-0123456789abcdef' });
  await writeFile(lockPath, activeMetadata, 'utf8');
  const missionStore = deterministicMissionStore({ activePids: new Set([50505]) });

  await assert.rejects(
    () => recoverInterruptedMissions({ root, missionStore, clock: clock('2026-08-23T10:02:00.000Z') }),
    /mission write already in progress|operation retry timed out/,
  );
  assert.equal((await missionStore.loadMission({ root, missionId })).mission.status, 'accepted');
  assert.equal(await readFile(lockPath, 'utf8'), activeMetadata);
});

test('restart recovery assigns interrupted running missions to the recovery driver', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-recovery-'));
  const accepted = createMission({ id: 'running-1', intent: 'Inspect Ubuntu', clock: clock('2026-08-23T10:00:00.000Z') });
  const running = transitionMission(accepted, { type: 'running', agent: 'jarvis' }, { clock: clock('2026-08-23T10:01:00.000Z') });
  await saveMission({ root, mission: running });
  assert.deepEqual(await inspectRecovery({ root }), {
    resumable: [{ missionId: 'running-1', revision: 1, action: 'resume', assignedTo: 'qra_recovery_driver' }],
    blocked: [],
    corrupt: [],
  });
});

test('restart recovery reports blocked missions and ignores completed missions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-recovery-'));
  const base = createMission({ id: 'blocked-1', intent: 'Wait for host', clock: clock('2026-08-23T10:00:00.000Z') });
  const blocked = transitionMission(base, { type: 'blocked', agent: 'jarvis', detail: 'host unavailable' }, { clock: clock('2026-08-23T10:01:00.000Z') });
  await saveMission({ root, mission: blocked });

  const doneBase = createMission({ id: 'done-1', intent: 'Already finished', clock: clock('2026-08-23T10:00:00.000Z') });
  const doneRunning = transitionMission(doneBase, { type: 'running', agent: 'jarvis' }, { clock: clock('2026-08-23T10:01:00.000Z') });
  const completed = transitionMission(doneRunning, { type: 'completed', agent: 'jarvis', proof: { verified: true, path: 'proofs/done-1.json', sha256: 'a'.repeat(64) } }, { clock: clock('2026-08-23T10:02:00.000Z') });
  await saveMission({ root, mission: completed });

  assert.deepEqual(await inspectRecovery({ root }), {
    resumable: [],
    blocked: [{ missionId: 'blocked-1', revision: 1, detail: 'host unavailable' }],
    corrupt: [],
  });
});

test('restart recovery exposes corrupt snapshots without deleting or executing them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-recovery-'));
  await mkdir(join(root, 'missions'));
  await writeFile(join(root, 'missions', 'broken.json'), '{bad-json', 'utf8');
  assert.deepEqual(await inspectRecovery({ root }), {
    resumable: [],
    blocked: [],
    corrupt: [{ missionId: 'broken', reason: 'corrupt mission snapshot' }],
  });
});

test('startup recovery blocks accepted and running missions without changing terminal missions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-recovery-'));
  const accepted = createMission({ id: 'accepted-1', intent: 'Run Titan tests', clock: clock('2026-08-23T10:00:00.000Z') });
  const runningBase = createMission({ id: 'running-2', intent: 'Run Titan tests', clock: clock('2026-08-23T10:00:00.000Z') });
  const running = transitionMission(runningBase, { type: 'running', agent: 'rune' }, { clock: clock('2026-08-23T10:01:00.000Z') });
  const blockedBase = createMission({ id: 'blocked-3', intent: 'Wait for host', clock: clock('2026-08-23T10:00:00.000Z') });
  const blocked = transitionMission(blockedBase, { type: 'blocked', agent: 'qra_recovery_driver', detail: 'already blocked' }, { clock: clock('2026-08-23T10:01:00.000Z') });
  const completedBase = createMission({ id: 'completed-4', intent: 'Finished', clock: clock('2026-08-23T10:00:00.000Z') });
  const completedRunning = transitionMission(completedBase, { type: 'running', agent: 'rune' }, { clock: clock('2026-08-23T10:01:00.000Z') });
  const completed = transitionMission(completedRunning, {
    type: 'completed', agent: 'qra_emerge_audit', proof: { verified: true, path: 'proofs/completed-4.json', sha256: 'a'.repeat(64) },
  }, { clock: clock('2026-08-23T10:02:00.000Z') });
  await Promise.all([
    saveMission({ root, mission: accepted }),
    saveMission({ root, mission: running }),
    saveMission({ root, mission: blocked }),
    saveMission({ root, mission: completed }),
  ]);

  assert.deepEqual(await recoverInterruptedMissions({ root, clock: clock('2026-08-23T10:03:00.000Z') }), {
    recovered: ['accepted-1', 'running-2'],
    blocked: [{ missionId: 'blocked-3', revision: 1, detail: 'already blocked' }],
    corrupt: [],
  });

  for (const missionId of ['accepted-1', 'running-2']) {
    const record = await loadMission({ root, missionId });
    assert.equal(record.revision, 2);
    assert.equal(record.mission.status, 'blocked');
    assert.deepEqual(record.mission.signals.at(-1), {
      missionId,
      type: 'blocked',
      agent: 'qra_recovery_driver',
      at: '2026-08-23T10:03:00.000Z',
      detail: 'interrupted execution requires operator retry',
    });
  }
  assert.equal((await loadMission({ root, missionId: 'blocked-3' })).revision, 1);
  assert.equal((await loadMission({ root, missionId: 'completed-4' })).revision, 1);
});

test('startup recovery is idempotent after it has converged an interrupted mission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-recovery-'));
  await saveMission({ root, mission: createMission({ id: 'mission-repeat', intent: 'Run Titan tests', clock: clock('2026-08-23T10:00:00.000Z') }) });
  const first = await recoverInterruptedMissions({ root, clock: clock('2026-08-23T10:01:00.000Z') });
  const second = await recoverInterruptedMissions({ root, clock: clock('2026-08-23T10:02:00.000Z') });
  assert.deepEqual(first, { recovered: ['mission-repeat'], blocked: [], corrupt: [] });
  assert.deepEqual(second, { recovered: [], blocked: [{ missionId: 'mission-repeat', revision: 2, detail: 'interrupted execution requires operator retry' }], corrupt: [] });
  assert.equal((await loadMission({ root, missionId: 'mission-repeat' })).revision, 2);
});

test('concurrent startup recovery callers converge on one durable recovery block', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-recovery-'));
  await saveMission({ root, mission: createMission({ id: 'mission-concurrent', intent: 'Run Titan tests', clock: clock('2026-08-23T10:00:00.000Z') }) });
  const [left, right] = await Promise.all([
    recoverInterruptedMissions({ root, clock: clock('2026-08-23T10:01:00.000Z') }),
    recoverInterruptedMissions({ root, clock: clock('2026-08-23T10:01:01.000Z') }),
  ]);
  assert.deepEqual(left, { recovered: ['mission-concurrent'], blocked: [], corrupt: [] });
  assert.deepEqual(right, { recovered: ['mission-concurrent'], blocked: [], corrupt: [] });
  const record = await loadMission({ root, missionId: 'mission-concurrent' });
  assert.equal(record.revision, 2);
  assert.equal(record.mission.status, 'blocked');
  assert.equal(record.mission.signals.at(-1).agent, 'qra_recovery_driver');
  assert.equal(record.mission.signals.at(-1).detail, 'interrupted execution requires operator retry');
});

test('startup recovery preserves authoritative lineage with a stable recovery operation ID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'athere-authoritative-recovery-'));
  const state = createMissionStateService({ root, clock: clock('2026-08-23T10:00:00.000Z') });
  await state.create({
    operationId: 'op-create-recoverable-1',
    id: 'mission-authoritative-recovery',
    objective: 'Recover without corrupting authoritative history',
    goals: [{ id: 'goal-1', objective: 'Recover' }],
    subgoals: [{ id: 'recover', objective: 'Recover safely', goalId: 'goal-1' }],
    dependencies: [],
    constraints: [],
    permissions: [{ actor: 'qra_recovery_driver', actions: ['block_interrupted_mission'] }],
    currentPlan: { id: 'plan-1', version: 1, steps: ['recover'] },
    environmentObservations: [],
  });

  assert.deepEqual(await recoverInterruptedMissions({ root, clock: clock('2026-08-23T10:01:00.000Z') }), {
    recovered: ['mission-authoritative-recovery'], blocked: [], corrupt: [],
  });
  assert.equal((await state.verifyHistory({ missionId: 'mission-authoritative-recovery' })).valid, true);
  const history = await state.history({ missionId: 'mission-authoritative-recovery' });
  assert.equal(history.at(-1).operationId, 'mission-authoritative-recovery-recovery-block');
});

test('startup recovery imports legacy snapshots into the authoritative transition ledger', async () => {
  const root = await mkdtemp(join(tmpdir(), 'athere-legacy-recovery-ledger-'));
  const missionId = 'legacy-recovery-ledger';
  await saveMission({ root, mission: createMission({ id: missionId, intent: 'Recover legacy mission', clock: clock('2026-08-23T10:00:00.000Z') }) });

  await recoverInterruptedMissions({ root, clock: clock('2026-08-23T10:01:00.000Z') });

  const record = await loadMission({ root, missionId });
  assert.equal(record.revision, 2);
  assert.equal(record.mission.transitionHistory.length, 2);
  assert.equal(record.mission.transitionHistory[0].action, 'import_legacy_snapshot');
  assert.equal(record.mission.transitionHistory[1].operationId, 'legacy-recovery-ledger-recovery-block');
  const state = createMissionStateService({ root });
  const verification = await state.verifyHistory({ missionId });
  assert.equal(verification.valid, true);
  assert.equal(verification.stateVersion, 2);
});
