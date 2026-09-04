import { createHash } from 'node:crypto';

/** Hard cap against checkpoint DoS via recovery ops. */
export const MAX_CHECKPOINTS = 32;

const SNAPSHOT_FIELDS = Object.freeze([
  'status',
  'completedWork',
  'pendingWork',
  'failedWork',
  'evidence',
  'artifactReferences',
  'activeAgents',
  'environmentObservations',
]);

export function assertCheckpointCap(checkpoints) {
  if (!Array.isArray(checkpoints)) throw new TypeError('checkpoints must be an array');
  if (checkpoints.length > MAX_CHECKPOINTS) {
    throw new Error(`checkpoints exceed cap (${MAX_CHECKPOINTS})`);
  }
  return true;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function requiredId(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new TypeError(`${label} must be a safe id`);
  }
  return value;
}

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function captureCheckpointSnapshot(mission) {
  if (!mission || typeof mission !== 'object' || Array.isArray(mission)) {
    throw new TypeError('mission is required to capture a checkpoint');
  }
  const snapshot = {};
  for (const field of SNAPSHOT_FIELDS) {
    snapshot[field] = structuredClone(mission[field] ?? (field === 'status' ? 'accepted' : []));
  }
  return Object.freeze(snapshot);
}

export function hashCheckpointSnapshot(snapshot) {
  return createHash('sha256').update(JSON.stringify(canonicalize(snapshot))).digest('hex');
}

export function buildCheckpointRecord({ id, label, revision, actor, createdAt, mission }) {
  const snapshot = captureCheckpointSnapshot(mission);
  return Object.freeze({
    id: requiredId(id, 'checkpoint id'),
    label: requiredText(label, 'checkpoint label'),
    revision,
    actor: requiredId(actor, 'checkpoint actor'),
    createdAt: requiredText(createdAt, 'checkpoint createdAt'),
    verified: true,
    stateHash: hashCheckpointSnapshot(snapshot),
    snapshot,
  });
}

export function findCheckpoint(mission, checkpointId) {
  const id = requiredId(checkpointId, 'checkpoint id');
  const checkpoint = (mission.checkpoints ?? []).find((entry) => entry.id === id);
  if (!checkpoint) throw new Error(`checkpoint not found: ${id}`);
  return checkpoint;
}

export function assertCheckpointIntegrity(checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
    throw new TypeError('checkpoint must be an object');
  }
  if (checkpoint.verified !== true) throw new Error(`checkpoint is not verified: ${checkpoint.id}`);
  const recomputed = hashCheckpointSnapshot(checkpoint.snapshot);
  if (recomputed !== checkpoint.stateHash) {
    throw new Error(`checkpoint integrity failed: ${checkpoint.id}`);
  }
  return true;
}

export function buildBranchRecord({ id, checkpointId, strategy, actor, createdAt }) {
  return Object.freeze({
    id: requiredId(id, 'branch id'),
    fromCheckpointId: requiredId(checkpointId, 'branch checkpoint id'),
    strategy: requiredText(strategy, 'branch strategy'),
    status: 'active',
    actor: requiredId(actor, 'branch actor'),
    createdAt: requiredText(createdAt, 'branch createdAt'),
  });
}

export function findBranch(mission, branchId) {
  const id = requiredId(branchId, 'branch id');
  const branch = (mission.branches ?? []).find((entry) => entry.id === id);
  if (!branch) throw new Error(`branch not found: ${id}`);
  return branch;
}

export function applyCheckpointSnapshot(mission, checkpoint, { resyncObservation } = {}) {
  assertCheckpointIntegrity(checkpoint);
  const snapshot = checkpoint.snapshot;
  const observations = Array.isArray(snapshot.environmentObservations)
    ? [...snapshot.environmentObservations]
    : [];
  if (resyncObservation) observations.push(resyncObservation);
  return Object.freeze({
    ...mission,
    completedWork: Object.freeze(structuredClone(snapshot.completedWork ?? [])),
    pendingWork: Object.freeze(structuredClone(snapshot.pendingWork ?? [])),
    failedWork: Object.freeze(structuredClone(snapshot.failedWork ?? [])),
    evidence: Object.freeze(structuredClone(snapshot.evidence ?? [])),
    artifactReferences: Object.freeze(structuredClone(snapshot.artifactReferences ?? [])),
    activeAgents: Object.freeze(structuredClone(snapshot.activeAgents ?? [])),
    environmentObservations: Object.freeze(structuredClone(observations)),
  });
}

export function recoveryPermissionActions() {
  return Object.freeze([
    'block_interrupted_mission',
    'create_checkpoint',
    'create_branch',
    'quarantine_branch',
    'rollback_to_checkpoint',
    'retry_from_checkpoint',
  ]);
}
