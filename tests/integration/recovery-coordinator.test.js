import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMission, transitionMission } from '../../packages/contracts/src/mission.js';
import { saveMission } from '../../packages/mission/src/mission-store.js';
import { inspectRecovery, recoverInterruptedMissions } from '../../packages/recovery/src/recovery-coordinator.js';
import { loadMission } from '../../packages/mission/src/mission-store.js';

const clock = (value) => () => value;

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
