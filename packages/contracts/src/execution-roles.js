const ROLES = Object.freeze({
  manager: 'manager',
  executor: 'executor',
  auditor: 'auditor',
  recovery: 'recovery',
});

const AGENT_ROLES = Object.freeze({
  'miss-vale-prime': ROLES.manager,
  nyx: ROLES.executor,
  rune: ROLES.executor,
  qra_emerge_audit: ROLES.auditor,
  qra_recovery_driver: ROLES.recovery,
});

const EXECUTOR_ACTIONS = Object.freeze(new Set([
  'observe_repository',
  'execute_node_tests',
  'mutate_workspace_files',
  'execute_titan_build',
]));
const AUDITOR_ACTIONS = Object.freeze(new Set(['verify_proof']));
const MANAGER_ACTIONS = Object.freeze(new Set(['supervise_mission']));
const RECOVERY_ACTIONS = Object.freeze(new Set([
  'block_interrupted_mission',
  'create_checkpoint',
  'create_branch',
  'quarantine_branch',
  'rollback_to_checkpoint',
  'retry_from_checkpoint',
]));
const RECOVERY_RESUME_ACTIONS = Object.freeze(new Set([
  'rollback_to_checkpoint',
  'retry_from_checkpoint',
]));

function requiredAgentId(agentId) {
  if (typeof agentId !== 'string' || agentId.trim().length === 0) {
    throw new TypeError('agent id must be a non-empty string');
  }
  return agentId.trim();
}

export function executionRoles() {
  return ROLES;
}

export function roleForAgent(agentId) {
  const id = requiredAgentId(agentId);
  const role = AGENT_ROLES[id];
  if (!role) throw new Error(`unknown operational agent: ${id}`);
  return role;
}

export function agentsForRole(role) {
  if (!Object.values(ROLES).includes(role)) throw new Error(`unknown execution role: ${role}`);
  return Object.freeze(Object.entries(AGENT_ROLES).filter(([, mapped]) => mapped === role).map(([agentId]) => agentId));
}

export function isRecoveryAction(action) {
  return typeof action === 'string' && RECOVERY_ACTIONS.has(action);
}

export function assertRoleMayEmitSignal(role, signalType, { action } = {}) {
  if (signalType === undefined) return;
  if (signalType === 'completed' && role !== ROLES.auditor) {
    throw new Error(`${role} cannot emit completed; only auditor may certify mission success`);
  }
  if (signalType === 'blocked' && role !== ROLES.recovery) {
    throw new Error(`${role} cannot emit blocked; only recovery may block interrupted missions`);
  }
  if (signalType === 'running' && role === ROLES.recovery) {
    if (!RECOVERY_RESUME_ACTIONS.has(action)) {
      throw new Error(`${role} cannot emit running; recovery may only block interrupted missions`);
    }
    return;
  }
  // Auditor may emit running when approving intermediate subgoal transitions; mission
  // completion remains completed-only and proof-gated in the mission state service.
}

export function assertRoleMayPerformAction(role, action) {
  if (typeof action !== 'string' || action.trim().length === 0) {
    throw new TypeError('action must be a non-empty string');
  }
  if (EXECUTOR_ACTIONS.has(action) && role !== ROLES.executor) {
    throw new Error(`${role} cannot perform executor action: ${action}`);
  }
  if (AUDITOR_ACTIONS.has(action) && role !== ROLES.auditor) {
    throw new Error(`${role} cannot perform auditor action: ${action}`);
  }
  if (MANAGER_ACTIONS.has(action) && role !== ROLES.manager) {
    throw new Error(`${role} cannot perform manager action: ${action}`);
  }
  if (RECOVERY_ACTIONS.has(action) && role !== ROLES.recovery) {
    throw new Error(`${role} cannot perform recovery action: ${action}`);
  }
}

export function assertRoleMayAdvanceCompletedWork(role) {
  if (role !== ROLES.auditor) {
    throw new Error(`${role} cannot advance completedWork; only auditor may certify subgoal success`);
  }
}

/**
 * Agent ids on the independence path are always service-recorded and drawn from the
 * closed fleet registry above (mirrored by the OPERATIONS map in `agent-operation.js`),
 * so trim + casefold is the whole normalization. Caller-supplied payload text is never
 * an identity source here, so there is nothing to fold lookalikes or encodings against.
 */
export function normalizeAgentId(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

/**
 * A ledger entry records *performance* when the actor wrote work evidence into
 * authoritative mission state, or performed an executor action. Both facts are
 * written by the mission state service from the validated envelope and its own
 * before/after state diff — a caller cannot author either one.
 */
function entryRecordsPerformance(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.action === 'string' && EXECUTOR_ACTIONS.has(entry.action)) return true;
  const evidenceChange = entry.changes?.evidence;
  if (!evidenceChange || typeof evidenceChange !== 'object') return false;
  return Array.isArray(evidenceChange.after) && evidenceChange.after.length > 0;
}

/**
 * The recorded performer set: who the service observed performing work on this
 * mission, taken only from its own hash-chained `transitionHistory`.
 */
export function recordedWorkPerformers(transitionHistory = []) {
  if (!Array.isArray(transitionHistory)) throw new TypeError('transitionHistory must be an array');
  const performers = new Set();
  for (const entry of transitionHistory) {
    if (!entryRecordsPerformance(entry)) continue;
    const actor = normalizeAgentId(entry.actor);
    if (actor) performers.add(actor);
  }
  return performers;
}

/**
 * True when the transition under authorization would itself write work evidence into
 * authoritative state. The certifier would then be the recorded actor of a performance
 * entry, so perform-and-certify in one transition is the same violation as doing it
 * across two. Only the presence of the write matters; its contents are never read.
 */
function updateWritesWorkEvidence(update) {
  if (!Object.hasOwn(update, 'evidence')) return false;
  const evidence = update.evidence;
  return Array.isArray(evidence) ? evidence.length > 0 : evidence !== undefined && evidence !== null;
}

function requiredPlanSteps(mission) {
  const planSteps = mission?.currentPlan?.steps;
  if (Array.isArray(planSteps) && planSteps.length > 0) return planSteps;
  const subgoals = mission?.subgoals;
  if (Array.isArray(subgoals) && subgoals.length > 0) {
    return subgoals.map((entry) => entry?.id).filter((id) => typeof id === 'string' && id.trim().length > 0);
  }
  return [];
}

function assertCompletedSignalWorkCertified({ mission, update }) {
  if (!mission || typeof mission !== 'object' || Array.isArray(mission)) {
    throw new TypeError('mission is required to authorize completed success');
  }
  const completedWork = Object.hasOwn(update, 'completedWork')
    ? update.completedWork
    : (mission.completedWork ?? []);
  const pendingWork = Object.hasOwn(update, 'pendingWork')
    ? update.pendingWork
    : (mission.pendingWork ?? []);
  const failedWork = Object.hasOwn(update, 'failedWork')
    ? update.failedWork
    : (mission.failedWork ?? []);
  if (!Array.isArray(completedWork)) throw new TypeError('completedWork must be an array');
  if (!Array.isArray(pendingWork)) throw new TypeError('pendingWork must be an array');
  if (!Array.isArray(failedWork)) throw new TypeError('failedWork must be an array');
  if (pendingWork.length > 0) {
    throw new Error('completed signal requires empty pendingWork after auditor-certified work completion');
  }
  if (failedWork.length > 0) {
    throw new Error('completed signal requires empty failedWork after auditor-certified work completion');
  }
  const required = requiredPlanSteps(mission);
  if (required.length === 0) {
    throw new Error('completed signal requires a plan or subgoals to certify completedWork against');
  }
  const completed = new Set(completedWork);
  const missing = required.filter((step) => !completed.has(step));
  if (missing.length > 0) {
    throw new Error(
      `completed signal requires completedWork covering required plan/subgoals; missing: ${missing.join(', ')}`,
    );
  }
}

/**
 * Independence is decided by comparing service-recorded identities to service-recorded
 * identities: the authorized envelope agent against the recorded actors of the mission's
 * own performance transitions. Evidence, results, and artifact references supplied by the
 * caller are deliberately not consulted — the attacker controls that haystack, and
 * searching it for a name can never be proven closed.
 */
export function assertIndependentSuccessCertification({
  certifierAgentId,
  recordedPerformers = [],
  certifierPerformsInThisTransition = false,
} = {}) {
  const certifier = requiredAgentId(certifierAgentId);
  const certifierNorm = normalizeAgentId(certifier);
  if (!certifierNorm) {
    throw new TypeError('certifier agent id must be a non-empty string after normalization');
  }
  const performed = certifierPerformsInThisTransition
    || [...recordedPerformers].some((performer) => normalizeAgentId(performer) === certifierNorm);
  if (performed) {
    throw new Error(`agent ${certifier} cannot certify success for work it also performed`);
  }
}

export function authorizeCompletedWorkClaim({
  agentId,
  transitionHistory = [],
  update = {},
  signalType,
  mission,
} = {}) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) {
    throw new TypeError('update must be an object');
  }
  const claimsCompletedWork = Object.hasOwn(update, 'completedWork');
  const isMissionCompletion = signalType === 'completed';
  if (!claimsCompletedWork && !isMissionCompletion) {
    return Object.freeze({ enforced: false });
  }
  const role = roleForAgent(agentId);
  assertRoleMayAdvanceCompletedWork(role);
  if (!Array.isArray(transitionHistory) || transitionHistory.length === 0) {
    throw new Error('cannot certify success on a pre-ledger mission without transition history');
  }
  if (isMissionCompletion) {
    assertCompletedSignalWorkCertified({ mission, update });
  }
  assertIndependentSuccessCertification({
    certifierAgentId: agentId,
    recordedPerformers: recordedWorkPerformers(transitionHistory),
    certifierPerformsInThisTransition: updateWritesWorkEvidence(update),
  });
  return Object.freeze({ enforced: true, role, agentId });
}
