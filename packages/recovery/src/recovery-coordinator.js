import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createAgentOperationEnvelope } from '../../contracts/src/agent-operation.js';
import { assertCheckpointIntegrity } from '../../mission/src/mission-checkpoints.js';
import { isRecoverableCheckpoint } from '../../mission/src/current-job-pointer.js';
import { defaultMissionStore, listMissionIds as listFilesystemMissionIds } from '../../mission/src/mission-store.js';
import { createMissionStateService } from '../../mission/src/mission-state-service.js';

const RECOVERY_DETAIL = 'interrupted execution requires operator retry';
const RECOVERY_ATTEMPTS = 8;
const MAX_AUTO_HEALS = 3;
const DEFAULT_MISSION_STORE = defaultMissionStore;

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

export async function inspectRecovery({
  root,
  missionStore = DEFAULT_MISSION_STORE,
  clock = () => new Date().toISOString(),
} = {}) {
  const store = requireMissionStore(missionStore);
  const state = createMissionStateService({ root, clock, store });
  const result = { resumable: [], blocked: [], corrupt: [] };
  const missionIds = await resolveMissionIds({ root, store });

  for (const missionId of missionIds) {
    let record;
    try {
      // MH-04 / RH-H10: classify through ledger-verified get — never trust raw store status alone.
      record = await state.get({ missionId });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (/mission write already in progress|revision conflict/i.test(reason)) throw error;
      result.corrupt.push({ missionId, reason });
      continue;
    }

    if (
      (record.mission.status === 'accepted' || record.mission.status === 'running')
      && !hasRecoveryBlockPermission(record.mission)
    ) {
      result.corrupt.push({
        missionId,
        reason: 'missing recovery permission: qra_recovery_driver block_interrupted_mission',
      });
    } else if (record.mission.status === 'accepted' || record.mission.status === 'running') {
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

function hasRecoveryBlockPermission(mission) {
  return (mission.permissions ?? []).some(({ actor, actions }) => (
    actor === 'qra_recovery_driver'
      && Array.isArray(actions)
      && actions.includes('block_interrupted_mission')
  ));
}

function retryableRecoveryConflict(error) {
  return error?.message === 'mission write already in progress' || /^revision conflict: /.test(error?.message);
}

function recoveryOperationId(missionId, revision) {
  const readable = `${missionId}-recovery-block-v${revision}`;
  if (readable.length <= 128) return readable;
  return `recovery-block-${createHash('sha256').update(`${missionId}:${revision}`).digest('hex')}`;
}

function healOperationId(missionId, kind, token) {
  const digest = createHash('sha256').update(`${missionId}:${kind}:${token}`).digest('hex').slice(0, 24);
  return `heal-${kind}-${digest}`;
}

function verifiedCheckpoints(mission) {
  return (mission.checkpoints ?? []).filter((entry) => {
    // Crash/stop tie-ins are continuity, not a place to retry work from.
    if (!isRecoverableCheckpoint(entry) || !entry.snapshot) return false;
    assertCheckpointIntegrity(entry);
    return true;
  });
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
    const operationId = recoveryOperationId(missionId, record.revision);
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
          createdAt: clock(),
          taskId: 'recover-interrupted-mission',
        }),
      });
      return true;
    } catch (error) {
      if (retryableRecoveryConflict(error) && attempt < RECOVERY_ATTEMPTS - 1) {
        await delay(1);
        continue;
      }
      // Permission / authorization failures on one mission must not abort boot
      // for the whole shared store (legacy missions may omit recovery actors).
      const message = error instanceof Error ? error.message : String(error);
      if (/lacks required permission|not authorized/i.test(message)) return false;
      // Stable recovery op ids collide when a prior block payload differed
      // (e.g. heal resumed then crashed again with different pendingWork).
      if (/idempotency conflict/i.test(message)) {
        const again = await missionStore.loadMission({ root, missionId });
        if (recoveryBlocked(again)) return true;
        return false;
      }
      // I12A4: rethrow integrity failures so recoverInterruptedMissions can isolate
      // them into `corrupt` without aborting the rest of the fleet.
      if (/transition hash mismatch|transition history|integrity|corrupt/i.test(message)) {
        const corrupt = new Error(message);
        corrupt.code = 'MISSION_CORRUPT';
        throw corrupt;
      }
      throw error;
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
    const onMain = !activeBranchId || activeBranchId === 'main';
    // RH-H02: multi-checkpoint main-line auto-heal is poisonable (latest CP). Require branch first.
    if (onMain && checkpoints.length > 1) {
      return Object.freeze({
        status: 'skipped',
        reason: 'main has multiple checkpoints; open alternate branch before auto-heal',
      });
    }
    let retryCheckpoint = checkpoints.at(-1);
    if (typeof activeBranchId === 'string' && activeBranchId !== 'main') {
      const branch = (record.mission.branches ?? []).find((entry) => entry.id === activeBranchId);
      if (branch?.fromCheckpointId) {
        const origin = checkpoints.find((entry) => entry.id === branch.fromCheckpointId);
        if (origin) retryCheckpoint = origin;
      }
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
          createdAt: clock(),
          taskId: 'auto-heal-quarantine',
        }),
      });
    }

    if (!retryCheckpoint) {
      return Object.freeze({ status: 'skipped', reason: 'no verified checkpoint' });
    }
    const checkpoint = retryCheckpoint;
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
        createdAt: clock(),
        taskId: 'auto-heal-retry',
      }),
    });
    if (record.mission.status !== 'running') {
      return Object.freeze({ status: 'unhealed', reason: `heal left status ${record.mission.status}` });
    }
    return Object.freeze({ status: 'healed', revision: record.revision, checkpointId: checkpoint.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // MH-06: integrity / security failures must not soft-mask as ordinary unhealed.
    if (/transition hash mismatch|transition history|integrity|corrupt|checkpoint integrity|envelope timeout/i.test(message)) {
      const corrupt = new Error(message);
      corrupt.code = 'MISSION_CORRUPT';
      throw corrupt;
    }
    return Object.freeze({
      status: 'unhealed',
      reason: message,
    });
  }
}

export async function recoverInterruptedMissions({ root, clock = () => new Date().toISOString(), missionStore = DEFAULT_MISSION_STORE } = {}) {
  const store = requireMissionStore(missionStore);
  const inspection = await inspectRecovery({ root, missionStore: store, clock });
  const recovered = [];
  const skippedCorrupt = [];
  for (const item of inspection.resumable) {
    try {
      if (await convergeInterruptedMission({ root, missionId: item.missionId, clock, missionStore: store })) {
        recovered.push(item.missionId);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      // A live owner lease is contention, not corruption. Surface it so startup
      // cannot pretend recovery safely inspected or claimed that mission.
      if (/mission write already in progress|operation retry timed out|revision conflict/i.test(reason)) {
        throw error;
      }
      // I12A4: one bad mission must not abort fleet recovery.
      skippedCorrupt.push(Object.freeze({
        missionId: item.missionId,
        reason,
      }));
    }
  }
  return Object.freeze({
    recovered: Object.freeze(recovered),
    blocked: inspection.blocked,
    corrupt: Object.freeze([...(inspection.corrupt ?? []), ...skippedCorrupt]),
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
  const inspection = await inspectRecovery({ root, missionStore: store, clock });
  const healed = [];
  const unhealed = [];
  const skipped = [];
  for (const item of inspection.blocked) {
    try {
      const result = await healOneBlockedMission({
        root,
        missionId: item.missionId,
        clock,
        missionStore: store,
      });
      if (result.status === 'healed') healed.push(item.missionId);
      else if (result.status === 'unhealed') unhealed.push(Object.freeze({ missionId: item.missionId, reason: result.reason }));
      else skipped.push(Object.freeze({ missionId: item.missionId, reason: result.reason }));
    } catch (error) {
      unhealed.push(Object.freeze({
        missionId: item.missionId,
        reason: error instanceof Error ? error.message : String(error),
        corrupt: error?.code === 'MISSION_CORRUPT',
      }));
    }
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
    clock: options.clock,
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
