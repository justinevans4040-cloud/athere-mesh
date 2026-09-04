/**
 * Item 24 — distributed mission blackboard layer.
 * Primary remains sole writer; replicas + event stream increase read capacity.
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

/** Instance registry — not forgeable via Symbol.for. */
const BRANDED_DISTRIBUTED_STORES = new WeakSet();

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
  return value != null && BRANDED_DISTRIBUTED_STORES.has(value);
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
  /** Optional durable directory so replica reads work across processes/hosts. */
  durableReplicaDir = null,
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
  if (durableReplicaDir != null) {
    if (typeof durableReplicaDir !== 'string' || durableReplicaDir.trim().length === 0) {
      throw new TypeError('durableReplicaDir must be a non-empty string when provided');
    }
  }
  const durableRoot = durableReplicaDir == null ? null : path.resolve(durableReplicaDir.trim());

  /** @type {Array<Map<string, object>>} */
  const replicas = Array.from({ length: replicaCount }, () => new Map());
  /** @type {object[]} */
  const events = [];
  let primaryLoadCount = 0;
  let replicaLoadCount = 0;

  function durablePath(replicaIndex, missionId) {
    return path.join(durableRoot, `replica-${replicaIndex}`, `${missionId}.json`);
  }

  async function syncReplicas(record) {
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
    if (durableRoot) {
      for (let index = 0; index < replicas.length; index += 1) {
        const target = durablePath(index, missionId);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, `${JSON.stringify(frozen)}\n`, 'utf8');
      }
    }
  }

  async function loadDurableReplica(replicaIndex, missionId) {
    if (!durableRoot) return null;
    try {
      const raw = await readFile(durablePath(replicaIndex, missionId), 'utf8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.revision !== 'number' || !parsed.mission) {
        throw new Error('corrupt durable replica snapshot');
      }
      return Object.freeze({
        revision: parsed.revision,
        mission: structuredClone(parsed.mission),
        stateHash: parsed.stateHash ?? hashMission(parsed.mission),
        syncedAt: parsed.syncedAt ?? now(),
      });
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
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

    async loadMission(args) {
      primaryLoadCount += 1;
      return primaryStore.loadMission(args);
    },

    async saveMission(args) {
      assertWriteAuthority('primary');
      const saved = await primaryStore.saveMission(args);
      await syncReplicas(saved);
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
      let entry = replicas[replicaIndex].get(id);
      if (!entry) {
        entry = await loadDurableReplica(replicaIndex, id);
        if (entry) replicas[replicaIndex].set(id, entry);
      }
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
        durable: durableRoot != null,
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
        durableReplicas: durableRoot != null,
        durableReplicaDir: durableRoot,
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

  BRANDED_DISTRIBUTED_STORES.add(layer);
  return layer;
}