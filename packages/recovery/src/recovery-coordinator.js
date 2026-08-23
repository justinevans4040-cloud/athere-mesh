import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { loadMission } from '../../mission/src/mission-store.js';

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
