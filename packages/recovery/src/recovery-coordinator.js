import { readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createAgentOperationEnvelope } from '../../contracts/src/agent-operation.js';
import { loadMission, saveMission } from '../../mission/src/mission-store.js';
import { createMissionStateService } from '../../mission/src/mission-state-service.js';

const SNAPSHOT = /^([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.json$/;
const RECOVERY_DETAIL = 'interrupted execution requires operator retry';
const RECOVERY_ATTEMPTS = 8;
const DEFAULT_MISSION_STORE = Object.freeze({ loadMission, saveMission });

function requireMissionStore(missionStore) {
  if (!missionStore || typeof missionStore.loadMission !== 'function' || typeof missionStore.saveMission !== 'function') {
    throw new TypeError('missionStore must provide loadMission and saveMission');
  }
  return missionStore;
}

export async function inspectRecovery({ root, missionStore = DEFAULT_MISSION_STORE }) {
  const store = requireMissionStore(missionStore);
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
      record = await store.loadMission({ root, missionId });
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

function recoveryBlocked(record) {
  const signal = record.mission.signals.at(-1);
  return record.mission.status === 'blocked'
    && signal?.agent === 'qra_recovery_driver'
    && signal.detail === RECOVERY_DETAIL;
}

function retryableRecoveryConflict(error) {
  return error?.message === 'mission write already in progress' || /^revision conflict: /.test(error?.message);
}

function recoveryOperationId(missionId) {
  const readable = `${missionId}-recovery-block`;
  if (readable.length <= 128) return readable;
  return `recovery-block-${createHash('sha256').update(missionId).digest('hex')}`;
}

async function convergeInterruptedMission({ root, missionId, clock, missionStore }) {
  for (let attempt = 0; attempt < RECOVERY_ATTEMPTS; attempt += 1) {
    const record = await missionStore.loadMission({ root, missionId });
    if (recoveryBlocked(record)) return true;
    if (record.mission.status !== 'accepted' && record.mission.status !== 'running') return false;
    const state = createMissionStateService({ root, clock, store: missionStore });
    const operationId = recoveryOperationId(missionId);
    try {
      await state.transition({
        operationId,
        missionId,
        expectedRevision: record.revision,
        signal: { type: 'blocked', agent: 'qra_recovery_driver', detail: RECOVERY_DETAIL },
        update: {
          activeAgents: [],
          failedWork: record.mission.pendingWork ?? [],
          pendingWork: [],
        },
        envelope: createAgentOperationEnvelope({
          record,
          operationId,
          agentId: 'qra_recovery_driver',
          objective: RECOVERY_DETAIL,
          createdAt: record.mission.updatedAt,
          taskId: 'recover-interrupted-mission',
        }),
      });
      return true;
    } catch (error) {
      if (!retryableRecoveryConflict(error) || attempt === RECOVERY_ATTEMPTS - 1) throw error;
      await delay(1);
    }
  }
  return false;
}

export async function recoverInterruptedMissions({ root, clock = () => new Date().toISOString(), missionStore = DEFAULT_MISSION_STORE } = {}) {
  const store = requireMissionStore(missionStore);
  const inspection = await inspectRecovery({ root, missionStore: store });
  const recovered = [];
  for (const item of inspection.resumable) {
    if (await convergeInterruptedMission({ root, missionId: item.missionId, clock, missionStore: store })) recovered.push(item.missionId);
  }
  return Object.freeze({
    recovered: Object.freeze(recovered),
    blocked: inspection.blocked,
    corrupt: inspection.corrupt,
  });
}
