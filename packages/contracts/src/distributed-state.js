/**
 * Item 24 — distributed blackboard / state layer contracts.
 * Distribution increases capacity without weakening state authority or verification.
 */

export const DISTRIBUTED_ROLES = Object.freeze(['primary', 'replica', 'event_log']);

export const FORBIDDEN_DISTRIBUTED_PATHS = Object.freeze([
  'multi_master_write',
  'crdt_authority_merge',
  'replica_promote_to_writer',
  'quorum_bypass_cas',
  'geo_dual_primary',
]);

const ROLE_SET = new Set(DISTRIBUTED_ROLES);
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requiredId(value, label) {
  const id = requiredText(value, label);
  if (!SAFE_ID.test(id)) throw new Error(`invalid ${label}`);
  return id;
}

function nonNegInt(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value;
}

export function normalizeDistributedRole(role) {
  const value = requiredText(role, 'role');
  if (!ROLE_SET.has(value)) throw new Error(`unknown distributed role: ${value}`);
  return value;
}

/** Only the primary may accept authoritative writes. */
export function assertWriteAuthority(role) {
  const normalized = normalizeDistributedRole(role);
  if (normalized !== 'primary') {
    throw new Error(`distributed write forbidden on role: ${normalized}`);
  }
  return normalized;
}

/** Replicas are capacity reads only — never authoritative for verification. */
export function assertReplicaNotAuthoritative(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new TypeError('replica snapshot must be an object');
  }
  if (snapshot.authoritative === true) {
    throw new Error('replica snapshot cannot claim authoritative=true');
  }
  if (snapshot.role === 'primary') {
    throw new Error('replica snapshot cannot claim primary role');
  }
  return true;
}

export function normalizeStateEvent(input) {
  const missionId = requiredId(input?.missionId, 'missionId');
  const revision = nonNegInt(input?.revision, 'revision');
  if (revision < 1) throw new Error('state event revision must be >= 1');
  const operationId = input?.operationId == null ? null : requiredId(input.operationId, 'operationId');
  const stateHash = requiredText(input?.stateHash, 'stateHash');
  const recordedAt = requiredText(input?.recordedAt, 'recordedAt');
  return Object.freeze({
    type: 'mission_state_saved',
    missionId,
    revision,
    operationId,
    stateHash,
    recordedAt,
    authoritative: true,
  });
}

/** Deterministic shard routing metadata — does not create multi-writer shards. */
export function resolveShardId(missionId, shardCount = 1) {
  const id = requiredId(missionId, 'missionId');
  const count = nonNegInt(shardCount, 'shardCount');
  if (count < 1) throw new Error('shardCount must be >= 1');
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = ((hash * 31) + id.charCodeAt(i)) >>> 0;
  }
  return `shard-${hash % count}`;
}

export function assertForbiddenDistributedPath(path) {
  const name = requiredText(path, 'path');
  if (FORBIDDEN_DISTRIBUTED_PATHS.includes(name)) {
    throw new Error(`forbidden distributed path: ${name}`);
  }
  throw new Error(`unknown distributed path: ${name}`);
}

export function assertCannotMergeAuthority({ left, right } = {}) {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    throw new TypeError('authority merge requires two snapshots');
  }
  if (left.revision !== right.revision || left.stateHash !== right.stateHash) {
    throw new Error('forbidden distributed path: crdt_authority_merge');
  }
  throw new Error('forbidden distributed path: crdt_authority_merge');
}

/** Replica snapshots must never feed QR18 / proof / completion verification. */
export function assertCannotVerifyFromReplica(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new TypeError('verification snapshot must be an object');
  }
  if (snapshot.authoritative === false || snapshot.role === 'replica') {
    throw new Error('replica snapshot cannot be used for verification');
  }
  return true;
}

export { requiredId as requireDistributedMissionId };