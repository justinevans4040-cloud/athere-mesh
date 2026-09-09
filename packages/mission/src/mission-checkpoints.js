import { createHash } from 'node:crypto';

/** Hard cap against checkpoint DoS via recovery ops. */
export const MAX_CHECKPOINTS = 32;
/** Hard cap against branch DoS via recovery ops. */
export const MAX_BRANCHES = 32;

/**
 * Item 12: verified checkpoints must restore work partitions AND reasoning
 * state so a failed path cannot poison facts/claims/bindings after rollback.
 */
const SNAPSHOT_FIELDS = Object.freeze([
  'status',
  'completedWork',
  'pendingWork',
  'failedWork',
  'evidence',
  'artifactReferences',
  'activeAgents',
  'environmentObservations',
  'authoritativeFacts',
  'epistemicClaims',
  'validatedSkillBindings',
  'improvementBindings',
]);

export function assertCheckpointCap(checkpoints) {
  if (!Array.isArray(checkpoints)) throw new TypeError('checkpoints must be an array');
  if (checkpoints.length > MAX_CHECKPOINTS) {
    throw new Error(`checkpoints exceed cap (${MAX_CHECKPOINTS})`);
  }
  return true;
}

export function assertBranchCap(branches) {
  if (!Array.isArray(branches)) throw new TypeError('branches must be an array');
  if (branches.length > MAX_BRANCHES) {
    throw new Error(`branches exceed cap (${MAX_BRANCHES})`);
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

function emptyDefault(field) {
  if (field === 'status') return 'accepted';
  return [];
}

export function captureCheckpointSnapshot(mission) {
  if (!mission || typeof mission !== 'object' || Array.isArray(mission)) {
    throw new TypeError('mission is required to capture a checkpoint');
  }
  const snapshot = {};
  for (const field of SNAPSHOT_FIELDS) {
    snapshot[field] = structuredClone(mission[field] ?? emptyDefault(field));
  }
  return Object.freeze(snapshot);
}

export function hashCheckpointSnapshot(snapshot) {
  return createHash('sha256').update(JSON.stringify(canonicalize(snapshot))).digest('hex');
}

export function buildCheckpointRecord({ id, label, revision, actor, createdAt, mission, tieIn }) {
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
    ...(tieIn === undefined ? {} : { tieIn: Object.freeze(structuredClone(tieIn)) }),
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

/**
 * Restore mission work + reasoning state from a verified checkpoint.
 * Environment resync is marked for executors to rebind (activeAgents cleared).
 */
export function applyCheckpointSnapshot(mission, checkpoint, { resyncObservation, clearActiveBranch = false } = {}) {
  assertCheckpointIntegrity(checkpoint);
  const snapshot = checkpoint.snapshot;
  const observations = Array.isArray(snapshot.environmentObservations)
    ? [...snapshot.environmentObservations]
    : [];
  if (resyncObservation) observations.push(resyncObservation);
  let branches = Array.isArray(mission.branches) ? [...mission.branches] : [];
  let activeBranchId = mission.activeBranchId ?? 'main';
  if (clearActiveBranch) {
    const activeId = typeof activeBranchId === 'string' ? activeBranchId : 'main';
    if (activeId !== 'main') {
      branches = branches.map((entry) => (
        entry.id === activeId && entry.status === 'active'
          ? Object.freeze({
            ...entry,
            status: 'quarantined',
            reason: entry.reason ?? 'auto-quarantined on rollback/retry',
          })
          : entry
      ));
    }
    activeBranchId = 'main';
  }
  return Object.freeze({
    ...mission,
    completedWork: Object.freeze(structuredClone(snapshot.completedWork ?? [])),
    pendingWork: Object.freeze(structuredClone(snapshot.pendingWork ?? [])),
    failedWork: Object.freeze(structuredClone(snapshot.failedWork ?? [])),
    evidence: Object.freeze(structuredClone(snapshot.evidence ?? [])),
    artifactReferences: Object.freeze(structuredClone(snapshot.artifactReferences ?? [])),
    // Force rebind after rollback/branch/retry — do not resurrect crashed agents.
    activeAgents: Object.freeze([]),
    environmentObservations: Object.freeze(structuredClone(observations)),
    authoritativeFacts: Object.freeze(structuredClone(snapshot.authoritativeFacts ?? [])),
    epistemicClaims: Object.freeze(structuredClone(snapshot.epistemicClaims ?? [])),
    validatedSkillBindings: Object.freeze(structuredClone(snapshot.validatedSkillBindings ?? [])),
    improvementBindings: Object.freeze(structuredClone(snapshot.improvementBindings ?? [])),
    ...(clearActiveBranch ? {
      branches: Object.freeze(branches),
      activeBranchId,
    } : {}),
  });
}
// Recovery permission policy is enforced by agent-operation authorization.
