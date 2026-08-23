import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMission, transitionMission } from '../../packages/contracts/src/mission.js';
import { saveMission } from '../../packages/mission/src/mission-store.js';
import { inspectRecovery } from '../../packages/recovery/src/recovery-coordinator.js';

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
