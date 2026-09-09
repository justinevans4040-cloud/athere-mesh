/**
 * Current-job pointer — singleton next to mission authority.
 * Chat / RAG / Cursor hooks are not this record. One writer + CAS.
 */

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export const CURRENT_JOB_SLOT = 'current';

export const OPERATIONAL_LOOKBACK_FIELDS = Object.freeze([
  'status',
  'objective',
  'completedWork',
  'pendingWork',
  'failedWork',
  'currentPlan',
  'evidence',
  'artifactReferences',
  'activeAgents',
  'checkpoints',
]);

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requiredId(value, label) {
  const id = requiredText(value, label);
  if (!SAFE_ID.test(id)) throw new TypeError(`${label} is invalid`);
  return id;
}

export function isAdvisoryMissionId(missionId) {
  return typeof missionId === 'string' && missionId.startsWith('advisory-');
}

export function assertOperationalAdmission({ missionId, stateVersion, envelope } = {}) {
  const id = envelope?.mission_id ?? missionId;
  const version = envelope?.state_version ?? stateVersion;
  if (isAdvisoryMissionId(id)) {
    throw new Error('advisory envelope cannot admit operational tools');
  }
  if (version === 0) {
    throw new Error('revision 0 advisory missions cannot admit operational tools');
  }
  if (envelope?.resource_budget && Number(envelope.resource_budget.max_tool_calls) > 0 && isAdvisoryMissionId(id)) {
    throw new Error('advisory envelope cannot admit operational tools');
  }
}

export function normalizeCurrentJobPointer(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('current-job pointer must be an object');
  }
  const jobId = requiredId(input.jobId, 'current-job pointer jobId');
  if (isAdvisoryMissionId(jobId)) {
    throw new Error('advisory envelope cannot admit operational tools');
  }
  const missionRevision = input.missionRevision;
  if (missionRevision !== undefined && (!Number.isSafeInteger(missionRevision) || missionRevision < 1)) {
    throw new TypeError('current-job pointer missionRevision must be a positive integer');
  }
  const actor = input.actor === undefined ? 'titan' : requiredId(input.actor, 'current-job pointer actor');
  const operationId = input.operationId === undefined
    ? undefined
    : requiredId(input.operationId, 'current-job pointer operationId');
  const updatedAt = input.updatedAt === undefined ? undefined : requiredText(input.updatedAt, 'current-job pointer updatedAt');
  if (updatedAt !== undefined && Number.isNaN(Date.parse(updatedAt))) {
    throw new TypeError('current-job pointer updatedAt must be an ISO timestamp');
  }
  return Object.freeze({
    slot: CURRENT_JOB_SLOT,
    jobId,
    ...(missionRevision === undefined ? {} : { missionRevision }),
    actor,
    ...(operationId === undefined ? {} : { operationId }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  });
}

export function isTieInCheckpoint(entry) {
  return typeof entry?.label === 'string' && entry.label.startsWith('tie-in-');
}

export function isWorkSliceCheckpoint(entry) {
  return typeof entry?.label === 'string' && entry.label.startsWith('after-');
}

/** Crash/stop tie-ins are continuity, not a place to retry work from. */
export function isRecoverableCheckpoint(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  if (isTieInCheckpoint(entry)) return false;
  return entry.verified === true
    && typeof entry.stateHash === 'string'
    && entry.stateHash.length > 0;
}

export function recoverableCheckpoints(mission) {
  return (mission?.checkpoints ?? []).filter((entry) => isRecoverableCheckpoint(entry));
}

export function hasWorkSliceCheckpoint(mission) {
  return (mission?.checkpoints ?? []).some((entry) => isWorkSliceCheckpoint(entry));
}

export function sliceProgress(mission) {
  if (!mission || typeof mission !== 'object') throw new TypeError('mission is required');
  const labels = new Set((mission.checkpoints ?? []).map((entry) => entry?.label).filter(Boolean));
  const agents = new Set((mission.evidence ?? []).map((entry) => entry?.agent).filter(Boolean));
  const signalAgents = new Set((mission.signals ?? []).map((entry) => entry?.agent).filter(Boolean));
  return Object.freeze({
    supervised: signalAgents.has('miss-vale-prime'),
    preLifecycle: signalAgents.has('caretaker'),
    inspected: labels.has('after-inspect') || agents.has('nyx'),
    tested: labels.has('after-tests') || agents.has('rune'),
    built: labels.has('after-build'),
    fileWork: labels.has('after-file-work'),
    postLifecycle: signalAgents.has('qra_sentinel'),
    certified: mission.status === 'completed',
    blocked: mission.status === 'blocked',
  });
}

export function nextConcreteStep(mission) {
  const progress = sliceProgress(mission);
  const planId = mission?.currentPlan?.id;
  if (progress.certified) return null;
  if (planId === 'titan-test-plan') {
    if (!progress.inspected) return 'inspect-repository';
    if (!progress.tested) return 'run-node-tests';
    return 'verify-proof';
  }
  if (planId === 'titan-build-plan') {
    if (!progress.inspected) return 'inspect-repository';
    if (!progress.built) return 'run-titan-build';
    return 'verify-proof';
  }
  const steps = Array.isArray(mission?.currentPlan?.steps) ? mission.currentPlan.steps : [];
  if (steps.includes('inventory-files') || steps.includes('organize-files')) {
    if (!progress.fileWork) return steps.find((step) => step === 'inventory-files' || step === 'organize-files') ?? steps[0];
    return 'verify-proof';
  }
  return steps.find((step) => !(mission.completedWork ?? []).includes(step)) ?? null;
}

export function nextNamedAgent(mission) {
  const step = nextConcreteStep(mission);
  if (step === 'inspect-repository' || step === 'inventory-files' || step === 'organize-files') return 'nyx';
  if (step === 'run-node-tests' || step === 'run-titan-build') return 'rune';
  if (step === 'verify-proof') return 'qra_emerge_audit';
  if (mission?.status === 'blocked') return 'qra_recovery_driver';
  return 'miss-vale-prime';
}

export function buildTieInRecord({
  jobId,
  revision,
  statusAfterStop,
  mission,
  actor,
  operationId,
  expectedRevision,
  nextStep,
  nextAgent,
  auditLadder,
  reason,
} = {}) {
  const id = requiredId(jobId ?? mission?.id, 'tie-in job id');
  if (!Number.isSafeInteger(revision) || revision < 1) throw new TypeError('tie-in revision must be a positive integer');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
    throw new TypeError('tie-in expectedRevision must be a positive integer');
  }
  const status = requiredText(statusAfterStop ?? mission?.status, 'tie-in status after stop');
  const checkpoints = mission?.checkpoints ?? [];
  const last = checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] : null;
  return Object.freeze({
    jobId: id,
    revision,
    statusAfterStop: status,
    workPartitions: Object.freeze({
      completedWork: Object.freeze([...(mission?.completedWork ?? [])]),
      pendingWork: Object.freeze([...(mission?.pendingWork ?? [])]),
      failedWork: Object.freeze([...(mission?.failedWork ?? [])]),
    }),
    lastCheckpoint: last
      ? Object.freeze({
        id: last.id ?? null,
        label: last.label ?? null,
        revision: last.revision ?? null,
      })
      : null,
    nextConcreteStep: nextStep === undefined ? nextConcreteStep(mission) : nextStep,
    actor: requiredId(actor, 'tie-in actor'),
    operationId: requiredId(operationId, 'tie-in operation id'),
    expectedRevision,
    evidenceRefs: Object.freeze((mission?.evidence ?? []).map((entry, index) => Object.freeze({
      index,
      agent: entry?.agent ?? null,
      executor: entry?.executor ?? null,
    }))),
    artifactRefs: Object.freeze((mission?.artifactReferences ?? []).map((entry) => Object.freeze({
      id: entry?.id ?? entry?.artifactId ?? null,
      artifactHash: entry?.artifactHash ?? null,
    }))),
    nextNamedAgent: nextAgent === undefined ? nextNamedAgent(mission) : nextAgent,
    reason: requiredText(reason, 'tie-in reason'),
    auditLadder: auditLadder === undefined || auditLadder === null
      ? null
      : Object.freeze(structuredClone(auditLadder)),
  });
}

export function liveJobStatuses() {
  return Object.freeze(['accepted', 'running', 'blocked']);
}

export function isLiveJobStatus(status) {
  return liveJobStatuses().includes(status);
}
