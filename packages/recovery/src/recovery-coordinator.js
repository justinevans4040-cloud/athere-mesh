import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createAgentOperationEnvelope } from '../../contracts/src/agent-operation.js';
import { listMissionIds as listFilesystemMissionIds, loadMission, saveMission } from '../../mission/src/mission-store.js';
import { createMissionStateService } from '../../mission/src/mission-state-service.js';

const RECOVERY_DETAIL = 'interrupted execution requires operator retry';
const RECOVERY_ATTEMPTS = 8;
const MAX_AUTO_HEALS = 3;
const DEFAULT_MISSION_STORE = Object.freeze({
  loadMission,
  saveMission,
  listMissionIds: listFilesystemMissionIds,
});

function requireMissionStore(missionStore) {
  if (!missionStore || typeof missionStore.loadMission !== 'function' || typeof missionStore.saveMission !== 'function') {
    throw new TypeError('missionStore must provide loadMission and saveMission');
  }
  return missionStore;
}

async function resolveMissionIds({ root, store }) {
  if (typeof store.listMissionIds === 'function') {
    const ids = await store.listMissionIds({ root });
    if (!Array.isArray(ids)) throw new TypeError('listMissionIds must return an array');
    return ids;
  }
  // Legacy stores without listMissionIds keep filesystem discovery.
  return listFilesystemMissionIds({ root });
}

export async function inspectRecovery({ root, missionStore = DEFAULT_MISSION_STORE }) {
  const store = requireMissionStore(missionStore);
  const result = { resumable: [], blocked: [], corrupt: [] };
  const missionIds = await resolveMissionIds({ root, store });

  for (const missionId of missionIds) {
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

function healOperationId(missionId, kind, token) {
  const digest = createHash('sha256').update(`${missionId}:${kind}:${token}`).digest('hex').slice(0, 24);
  return `heal-${kind}-${digest}`;
}

function verifiedCheckpoints(mission) {
  return (mission.checkpoints ?? []).filter((entry) => entry?.verified === true && entry.stateHash && entry.snapshot);
}

function autoHealCount(mission) {
  return (mission.transitionHistory ?? []).filter((entry) => (
    entry.action === 'retry_from_checkpoint' || entry.action === 'rollback_to_checkpoint'
  )).length;
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

async function healOneBlockedMission({ root, missionId, clock, missionStore }) {
  const state = createMissionStateService({ root, clock, store: missionStore });
  let record = await missionStore.loadMission({ root, missionId });
  if (record.mission.status !== 'blocked') {
    return Object.freeze({ status: 'skipped', reason: `status is ${record.mission.status}` });
  }
  const checkpoints = verifiedCheckpoints(record.mission);
  if (checkpoints.length === 0) {
    return Object.freeze({ status: 'skipped', reason: 'no verified checkpoint' });
  }
  const healCount = autoHealCount(record.mission);
  if (healCount >= MAX_AUTO_HEALS) {
    return Object.freeze({ status: 'unhealed', reason: `auto-heal cap reached (${MAX_AUTO_HEALS})` });
  }

  try {
    const activeBranchId = record.mission.activeBranchId;
    if (typeof activeBranchId === 'string' && activeBranchId !== 'main') {
      const quarantineId = healOperationId(missionId, 'quarantine', `${activeBranchId}:${healCount}`);
      record = await state.quarantineBranch({
        operationId: quarantineId,
        missionId,
        expectedRevision: record.revision,
        branchId: activeBranchId,
        reason: 'auto-heal quarantined failed strategy branch',
        envelope: createAgentOperationEnvelope({
          record,
          operationId: quarantineId,
          agentId: 'qra_recovery_driver',
          action: 'quarantine_branch',
          objective: 'quarantine failed branch before checkpoint retry',
          createdAt: record.mission.updatedAt,
          taskId: 'auto-heal-quarantine',
        }),
      });
    }

    const checkpoint = checkpoints.at(-1);
    const retryId = healOperationId(missionId, 'retry', `${checkpoint.id}:${healCount}`);
    record = await state.retryFromCheckpoint({
      operationId: retryId,
      missionId,
      expectedRevision: record.revision,
      checkpointId: checkpoint.id,
      envelope: createAgentOperationEnvelope({
        record,
        operationId: retryId,
        agentId: 'qra_recovery_driver',
        action: 'retry_from_checkpoint',
        objective: 'auto-heal retry from last verified checkpoint',
        createdAt: record.mission.updatedAt,
        taskId: 'auto-heal-retry',
      }),
    });
    if (record.mission.status !== 'running') {
      return Object.freeze({ status: 'unhealed', reason: `heal left status ${record.mission.status}` });
    }
    return Object.freeze({ status: 'healed', revision: record.revision, checkpointId: checkpoint.id });
  } catch (error) {
    return Object.freeze({
      status: 'unhealed',
      reason: error instanceof Error ? error.message : String(error),
    });
  }
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

export async function healMissionFromCheckpoint({
  root,
  missionId,
  clock = () => new Date().toISOString(),
  missionStore = DEFAULT_MISSION_STORE,
} = {}) {
  if (typeof missionId !== 'string' || missionId.trim().length === 0) {
    throw new TypeError('missionId is required');
  }
  const result = await healOneBlockedMission({
    root,
    missionId: missionId.trim(),
    clock,
    missionStore: requireMissionStore(missionStore),
  });
  return result;
}

export async function healBlockedMissionsFromCheckpoints({
  root,
  clock = () => new Date().toISOString(),
  missionStore = DEFAULT_MISSION_STORE,
} = {}) {
  const store = requireMissionStore(missionStore);
  const inspection = await inspectRecovery({ root, missionStore: store });
  const healed = [];
  const unhealed = [];
  const skipped = [];
  for (const item of inspection.blocked) {
    const result = await healOneBlockedMission({
      root,
      missionId: item.missionId,
      clock,
      missionStore: store,
    });
    if (result.status === 'healed') healed.push(item.missionId);
    else if (result.status === 'unhealed') unhealed.push(Object.freeze({ missionId: item.missionId, reason: result.reason }));
    else skipped.push(Object.freeze({ missionId: item.missionId, reason: result.reason }));
  }
  return Object.freeze({
    healed: Object.freeze(healed),
    unhealed: Object.freeze(unhealed),
    skipped: Object.freeze(skipped),
  });
}

export async function recoverAndHealMissions(options = {}) {
  const recovery = await recoverInterruptedMissions(options);
  const heal = await healBlockedMissionsFromCheckpoints(options);
  const inspection = await inspectRecovery({
    root: options.root,
    missionStore: options.missionStore ?? DEFAULT_MISSION_STORE,
  });
  return Object.freeze({
    recovered: recovery.recovered,
    healed: heal.healed,
    unhealed: heal.unhealed,
    skipped: heal.skipped,
    blocked: Object.freeze(inspection.blocked),
    corrupt: recovery.corrupt,
  });
}
