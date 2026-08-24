import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { transitionMission } from '../../contracts/src/mission.js';
import { loadMission, saveMission } from '../../mission/src/mission-store.js';

const SNAPSHOT = /^([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.json$/;

export async function inspectRecovery({ root }) {
  const result = { resumable: [], blocked: [], corrupt: [] };
  let entries;
  try {
    entries = await readdir(path.resolve(root, 'missions'), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return result;
    throw error;
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const match = SNAPSHOT.exec(entry.name);
    if (!match || !entry.isFile()) continue;
    const missionId = match[1];
    let record;
    try {
      record = await loadMission({ root, missionId });
    } catch (error) {
      result.corrupt.push({ missionId, reason: error.message });
      continue;
    }

    if (record.mission.status === 'accepted' || record.mission.status === 'running') {
      result.resumable.push({ missionId, revision: record.revision, action: 'resume', assignedTo: 'qra_recovery_driver' });
    } else if (record.mission.status === 'blocked') {
      const lastSignal = record.mission.signals.at(-1);
      result.blocked.push({ missionId, revision: record.revision, detail: lastSignal?.detail ?? 'blocked without detail' });
    }
  }
  return result;
}

export async function recoverInterruptedMissions({ root, clock = () => new Date().toISOString() } = {}) {
  const inspection = await inspectRecovery({ root });
  const recovered = [];
  for (const item of inspection.resumable) {
    const record = await loadMission({ root, missionId: item.missionId });
    const blocked = transitionMission(record.mission, {
      type: 'blocked',
      agent: 'qra_recovery_driver',
      detail: 'interrupted execution requires operator retry',
    }, { clock });
    await saveMission({ root, mission: blocked, expectedRevision: record.revision });
    recovered.push(item.missionId);
  }
  return Object.freeze({
    recovered: Object.freeze(recovered),
    blocked: inspection.blocked,
    corrupt: inspection.corrupt,
  });
}
