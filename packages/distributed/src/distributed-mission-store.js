/**
 * Item 24 — distributed mission blackboard layer.
 * Primary remains sole writer; replicas + event stream increase read capacity.
 */

import { createHash } from 'node:crypto';
import {
  assertCannotMergeAuthority,
  assertForbiddenDistributedPath,
  assertReplicaNotAuthoritative,
  assertWriteAuthority,
  normalizeStateEvent,
  requireDistributedMissionId,
  resolveShardId,
} from '../../contracts/src/distributed-state.js';

/** Hard caps against distributed-layer DoS. */
export const MAX_REPLICAS = 8;
export const MAX_STATE_EVENTS = 1024;
export const MAX_SHARDS = 64;
export const DISTRIBUTED_MISSION_STORE_BRAND = Symbol.for('athere.distributedMissionStore');

function hashMission(mission) {
  return createHash('sha256').update(JSON.stringify(mission)).digest('hex');
}

function requirePrimaryStore(primary) {
  if (!primary || typeof primary.loadMission !== 'function' || typeof primary.saveMission !== 'function') {
    throw new TypeError('primary store must provide loadMission and saveMission');
  }
  return primary;
}

export function isBrandedDistributedMissionStore(value) {
  return Boolean(value && value[DISTRIBUTED_MISSION_STORE_BRAND] === true);
}

/**
 * Wraps an authoritative primary store with read replicas and an append-only event stream.
 * Preserves revision CAS on the primary. Replicas never accept writes.
 */
export function createDistributedMissionStore({
  primary,
  replicaCount = 2,
  shardCount = 1,
  now = () => new Date().toISOString(),
  maxEvents = MAX_STATE_EVENTS,
} = {}) {
  const primaryStore = requirePrimaryStore(primary);
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (!Number.isSafeInteger(replicaCount) || replicaCount < 1 || replicaCount > MAX_REPLICAS) {
    throw new Error(`replicaCount must be 1..${MAX_REPLICAS}`);
  }
  if (!Number.isSafeInteger(shardCount) || shardCount < 1 || shardCount > MAX_SHARDS) {
    throw new Error(`shardCount must be 1..${MAX_SHARDS}`);
  }
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > MAX_STATE_EVENTS) {
    throw new Error(`maxEvents must be 1..${MAX_STATE_EVENTS}`);
  }

  /** @type {Array<Map<string, object>>} */
  const replicas = Array.from({ length: replicaCount }, () => new Map());
  /** @type {object[]} */
  const events = [];
  let primaryLoadCount = 0;
  let replicaLoadCount = 0;

  function syncReplicas(record) {
    const missionId = record.mission.id;
    const frozen = Object.freeze({
      revision: record.revision,
      mission: structuredClone(record.mission),
      stateHash: hashMission(record.mission),
      syncedAt: now(),
    });
    for (const map of replicas) {
      map.set(missionId, frozen);
    }
  }

  function appendEvent(record, operationId = null) {
    const event = normalizeStateEvent({
      missionId: record.mission.id,
      revision: record.revision,
      operationId,
      stateHash: hashMission(record.mission),
      recordedAt: now(),
    });
    events.push(event);
    while (events.length > maxEvents) events.shift();
    return event;
  }

  const layer = Object.freeze({
    role: 'primary',
    replicaCount,
    shardCount,
    [DISTRIBUTED_MISSION_STORE_BRAND]: true,

    async loadMission(args) {
      primaryLoadCount += 1;
      return primaryStore.loadMission(args);
    },

    async saveMission(args) {
      assertWriteAuthority('primary');
      const saved = await primaryStore.saveMission(args);
      syncReplicas(saved);
      const history = saved?.mission?.transitionHistory;
      const lastOp = Array.isArray(history) && history.length > 0
        ? history[history.length - 1]?.operationId ?? null
        : null;
      appendEvent(saved, lastOp);
      return saved;
    },

    async loadMissionReplica({ missionId, replicaIndex = 0, root } = {}) {
      void root;
      const id = requireDistributedMissionId(missionId, 'missionId');
      if (!Number.isSafeInteger(replicaIndex) || replicaIndex < 0 || replicaIndex >= replicas.length) {
        throw new Error(`unknown replica index: ${replicaIndex}`);
      }
      const entry = replicas[replicaIndex].get(id);
      if (!entry) throw new Error(`replica miss for mission: ${id}`);
      replicaLoadCount += 1;
      const snapshot = Object.freeze({
        revision: entry.revision,
        mission: structuredClone(entry.mission),
        stateHash: entry.stateHash,
        syncedAt: entry.syncedAt,
        role: 'replica',
        replicaIndex,
        authoritative: false,
        shardId: resolveShardId(id, shardCount),
      });
      assertReplicaNotAuthoritative(snapshot);
      return snapshot;
    },

    listStateEvents({ missionId } = {}) {
      if (missionId == null) return Object.freeze([...events]);
      const id = requireDistributedMissionId(missionId, 'missionId');
      return Object.freeze(events.filter((event) => event.missionId === id));
    },

    topology() {
      return Object.freeze({
        role: 'primary',
        replicaCount,
        shardCount,
        eventCount: events.length,
        primaryLoadCount,
        replicaLoadCount,
        capacityReadsWithoutPrimary: replicaLoadCount,
        singleWriter: true,
        multiMaster: false,
        crdtAuthorityMerge: false,
      });
    },

    resolveShard(missionId) {
      return resolveShardId(missionId, shardCount);
    },

    async writeViaReplica(args) {
      assertWriteAuthority('replica');
      void args;
      throw new Error('unreachable');
    },

    promoteReplicaToWriter() {
      return assertForbiddenDistributedPath('replica_promote_to_writer');
    },

    mergeAuthority(left, right) {
      return assertCannotMergeAuthority({ left, right });
    },

    proposeQuorumBypassCas() {
      return assertForbiddenDistributedPath('quorum_bypass_cas');
    },

    enableGeoDualPrimary() {
      return assertForbiddenDistributedPath('geo_dual_primary');
    },

    enableMultiMasterWrite() {
      return assertForbiddenDistributedPath('multi_master_write');
    },
  });

  return layer;
}