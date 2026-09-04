import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { authorizeAgentOperation } from '../../contracts/src/agent-operation.js';
import { authorizeCompletedWorkClaim, roleForAgent } from '../../contracts/src/execution-roles.js';
import { createMission, transitionMission } from '../../contracts/src/mission.js';
import {
  assertValidMissionPath,
  buildWorkflowGraph,
  normalizeWorkflowEdges,
} from '../../contracts/src/workflow-graph.js';
import {
  EPISTEMIC_MAX_CLAIMS,
  assessEpistemicState,
  normalizeEpistemicClaim,
} from '../../contracts/src/epistemic-state.js';
import { verifyProof } from '../../proof/src/proof-store.js';
import {
  assertQr18LayersVerified,
  evaluateQr18Layers,
} from '../../proof/src/qr18-layered-verification.js';
import {
  applyCheckpointSnapshot,
  assertCheckpointCap,
  assertCheckpointIntegrity,
  buildBranchRecord,
  buildCheckpointRecord,
  findBranch,
  findCheckpoint,
  MAX_CHECKPOINTS,
} from './mission-checkpoints.js';
import {
  reconstructFailedMission,
  withAppendedTrace,
} from './mission-execution-trace.js';
import { loadMission, saveMission } from './mission-store.js';
import { projectMissionMemory, authorizeMemoryWrite } from '../../memory/src/typed-memory.js';
import { retrieveStateAwareMemory } from '../../memory/src/state-aware-retrieval.js';
import { decideNext, assertExecutiveActor } from '../../executive/src/executive-controller.js';
import { resolveAuthorityFromHistory } from '../../contracts/src/agent-identity.js';
import { createAgentIdentityRegistry, isBrandedAgentIdentityRegistry } from '../../identity/src/agent-identity-registry.js';
import {
  createGatedLearningPipeline,
  getGatedLearningIdentities,
  isBrandedGatedLearningPipeline,
} from '../../learning/src/gated-learning-pipeline.js';
import {
  createValidatedSkillLibrary,
  getValidatedSkillLearning,
  isBrandedValidatedSkillLibrary,
} from '../../skills/src/validated-skill-library.js';
import {
  createSelfImprovementSandbox,
  getSelfImprovementIdentities,
  isBrandedSelfImprovementSandbox,
} from '../../improvement/src/self-improvement-sandbox.js';
import { createDistributedMissionStore, isBrandedDistributedMissionStore } from '../../distributed/src/distributed-mission-store.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const FACT_STATUSES = new Set(['current', 'superseded', 'revoked', 'corrected', 'historical', 'tentative']);
const MUTABLE_FIELDS = new Set([
  'goals', 'subgoals', 'dependencies', 'completedWork', 'pendingWork', 'failedWork', 'evidence',
  'constraints', 'activeAgents', 'artifactReferences', 'currentPlan', 'environmentObservations',
  'authoritativeFacts',
]);
const SELECTABLE_FIELDS = new Set([
  'objective', 'permissions', 'currentFacts', 'checkpoints', 'branches', 'activeBranchId', 'workflowGraph',
  'executionTrace',
  ...[...MUTABLE_FIELDS].filter((field) => field !== 'authoritativeFacts'),
]);
const OPERATION_RETRY_TIMEOUT_MS = 5_000;
const OPERATION_RETRY_DELAY_MS = 10;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function stateWithoutHistory(mission) {
  const { transitionHistory: ignoredHistory, executionTrace: ignoredTrace, ...state } = mission;
  return state;
}

function stateHash(mission) {
  return createHash('sha256').update(JSON.stringify(canonicalize(stateWithoutHistory(mission)))).digest('hex');
}

function hashValue(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function transitionHash(record) {
  const { transitionHash: ignored, ...payload } = record;
  return hashValue(payload);
}

function stateChanges(before, after) {
  const changes = {};
  const beforeState = stateWithoutHistory(before);
  const afterState = stateWithoutHistory(after);
  for (const key of new Set([...Object.keys(beforeState), ...Object.keys(afterState)])) {
    if (JSON.stringify(canonicalize(beforeState[key])) !== JSON.stringify(canonicalize(afterState[key]))) {
      changes[key] = Object.freeze({ before: structuredClone(beforeState[key]), after: structuredClone(afterState[key]) });
    }
  }
  return Object.freeze(changes);
}

function transitionRecord({ stateVersion, previousVersion, previousTransitionHash, operationId = null, operationHashInput, actor, action, timestamp, input, before, after, authorization, evidence }) {
  const changes = stateChanges(before, after);
  const record = {
    transitionId: `${after.id}-transition-${stateVersion}`,
    stateVersion,
    previousVersion,
    previousTransitionHash: previousTransitionHash ?? null,
    operationId,
    operationHash: operationId === null ? null : hashValue(operationHashInput ?? input),
    actor,
    action,
    timestamp,
    input: Object.freeze(structuredClone(input)),
    output: Object.freeze({ status: after.status, changedFields: Object.freeze(Object.keys(changes).sort()) }),
    evidence: evidence === undefined ? null : Object.freeze(structuredClone(evidence)),
    verifier: 'mission-state-service',
    authorization: Object.freeze(structuredClone(authorization)),
    previousStateHash: previousVersion === 0 ? null : stateHash(before),
    stateHash: stateHash(after),
    changes,
    transitionResult: 'committed',
    rollbackTargetVersion: previousVersion === 0 ? null : previousVersion,
  };
  return Object.freeze({ ...record, transitionHash: transitionHash(record) });
}

function legacyImportRecord(mission, revision, timestamp) {
  const record = {
    transitionId: `${mission.id}-legacy-import-${revision}`,
    stateVersion: revision,
    previousVersion: revision > 1 ? revision - 1 : 0,
    previousTransitionHash: null,
    actor: 'mission-state-service',
    action: 'import_legacy_snapshot',
    timestamp,
    input: Object.freeze({ provenance: 'pre-ledger snapshot', priorHistoryAvailable: false }),
    output: Object.freeze({ status: mission.status, changedFields: Object.freeze([]) }),
    evidence: null,
    verifier: 'mission-state-service',
    authorization: Object.freeze({ actor: 'mission-state-service', actions: Object.freeze(['migrate_mission']), granted: true }),
    previousStateHash: null,
    stateHash: stateHash(mission),
    changes: Object.freeze({}),
    transitionResult: 'imported',
    rollbackTargetVersion: null,
  };
  return Object.freeze({ ...record, transitionHash: transitionHash(record) });
}

function verifyTransitionHistory(mission, revision) {
  const history = mission.transitionHistory ?? [];
  if (history.length === 0) throw new Error('transition history is missing');
  let previous = null;
  for (const record of history) {
    const isLegacyBoundary = !previous && record.action === 'import_legacy_snapshot' && record.previousStateHash === null;
    const expectedVersion = previous ? previous.stateVersion + 1 : (isLegacyBoundary ? record.stateVersion : 1);
    if (record.stateVersion !== expectedVersion || (!isLegacyBoundary && record.previousVersion !== expectedVersion - 1)) {
      throw new Error(`transition version mismatch at version ${record.stateVersion}`);
    }
    if (record.previousTransitionHash !== (previous?.transitionHash ?? null)) {
      throw new Error(`transition chain mismatch at version ${record.stateVersion}`);
    }
    if (previous && record.previousStateHash !== previous.stateHash) {
      throw new Error(`state hash chain mismatch at version ${record.stateVersion}`);
    }
    if (record.transitionHash !== transitionHash(record)) {
      throw new Error(`transition hash mismatch at version ${record.stateVersion}`);
    }
    previous = record;
  }
  if (previous.stateVersion !== revision) throw new Error('transition history does not match stored revision');
  const currentStateHash = stateHash(mission);
  if (previous.stateHash !== currentStateHash) throw new Error('transition history does not match authoritative state');
  return Object.freeze({ valid: true, missionId: mission.id, stateVersion: revision, transitionCount: history.length, stateHash: currentStateHash });
}

function requiredText(value, label) { if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string`); return value.trim(); }
function requiredId(value, label) { const id = requiredText(value, label); if (!SAFE_ID.test(id)) throw new TypeError(`${label} is invalid`); return id; }
function boundedInteger(value, label, { min, max }) { if (!Number.isSafeInteger(value) || value < min || value > max) throw new TypeError(`${label} must be between ${min} and ${max}`); return value; }
function optionalId(value, label) { return value === undefined ? undefined : requiredId(value, label); }
function optionalIsoTimestamp(value, label) { if (value === undefined) return undefined; const timestamp = requiredText(value, label); if (Number.isNaN(Date.parse(timestamp))) throw new TypeError(`${label} must be an ISO timestamp`); return timestamp; }
function stringArray(value, label) { if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`); return Object.freeze(value.map((item) => requiredText(item, `${label} entry`))); }
function uniqueIds(items, label) { const ids = new Set(); for (const item of items) { const id = requiredId(item?.id, `${label} id`); if (ids.has(id)) throw new Error(`duplicate ${label} id: ${id}`); ids.add(id); } return ids; }
function records(value, label) { if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`); return Object.freeze(value.map((item) => { if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`${label} entry must be an object`); return Object.freeze(structuredClone(item)); })); }
function validateGoals(value) { const items = records(value, 'goals'); uniqueIds(items, 'goal'); for (const item of items) requiredText(item.objective, 'goal objective'); return items; }
function validateSubgoals(value, goalIds) { const items = records(value, 'subgoals'); const ids = uniqueIds(items, 'subgoal'); for (const item of items) { requiredText(item.objective, 'subgoal objective'); if (!goalIds.has(requiredId(item.goalId, 'subgoal goalId'))) throw new Error(`subgoal references unknown goal: ${item.goalId}`); } return { items, ids }; }
function validateDependencies(value, subgoalIds, goalIds = new Set()) {
  const items = normalizeWorkflowEdges(value);
  for (const item of items) {
    const fromOk = subgoalIds.has(item.from) || goalIds.has(item.from);
    const toOk = subgoalIds.has(item.to) || goalIds.has(item.to);
    if (!fromOk || !toOk) throw new Error('dependency references unknown node');
  }
  return items;
}
function validatePermissions(value) { const items = records(value, 'permissions'); for (const item of items) { requiredId(item.actor, 'permission actor'); stringArray(item.actions, 'permission actions'); } return items; }
function validatePlan(value, subgoalIds) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('currentPlan must be an object'); const plan = Object.freeze(structuredClone(value)); requiredId(plan.id, 'plan id'); if (!Number.isSafeInteger(plan.version) || plan.version < 1) throw new TypeError('plan version must be a positive integer'); const steps = stringArray(plan.steps, 'plan steps'); for (const step of steps) if (!subgoalIds.has(step)) throw new Error(`plan references unknown subgoal: ${step}`); return Object.freeze({ ...plan, steps }); }
function validateObservations(value) { const items = records(value, 'environmentObservations'); for (const item of items) { requiredText(item.source, 'observation source'); requiredText(item.key, 'observation key'); if (!Object.hasOwn(item, 'value')) throw new TypeError('observation value is required'); const observedAt = requiredText(item.observedAt, 'observation observedAt'); if (Number.isNaN(Date.parse(observedAt))) throw new TypeError('observation observedAt must be an ISO timestamp'); } return items; }

function normalizeFact(item) {
  const id = requiredId(item.id, 'fact id');
  const key = requiredText(item.key, 'fact key');
  const status = requiredText(item.status, 'fact status');
  if (!FACT_STATUSES.has(status)) throw new Error(`unsupported fact status: ${status}`);
  if (!Object.hasOwn(item, 'value')) throw new TypeError('fact value is required');
  const fact = { ...structuredClone(item), id, key, status, supersedes: optionalId(item.supersedes, 'fact supersedes'), supersededBy: optionalId(item.supersededBy, 'fact supersededBy'), correctedBy: optionalId(item.correctedBy, 'fact correctedBy'), revokedAt: optionalIsoTimestamp(item.revokedAt, 'fact revokedAt') };
  if (item.reason !== undefined) fact.reason = requiredText(item.reason, 'fact reason');
  for (const field of ['supersedes', 'supersededBy', 'correctedBy', 'revokedAt']) if (fact[field] === undefined) delete fact[field];
  return Object.freeze(fact);
}

function validateFacts(value) {
  if (!Array.isArray(value)) throw new TypeError('authoritativeFacts must be an array');
  const items = Object.freeze(value.map((item) => { if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError('authoritativeFacts entry must be an object'); return normalizeFact(item); }));
  const ids = uniqueIds(items, 'fact');
  const byId = new Map(items.map((item) => [item.id, item]));
  const currentByKey = new Map();
  for (const fact of items) {
    for (const reference of ['supersedes', 'supersededBy', 'correctedBy']) { if (fact[reference] !== undefined && !ids.has(fact[reference])) throw new Error(`fact ${fact.id} references unknown ${reference}: ${fact[reference]}`); if (fact[reference] === fact.id) throw new Error(`fact ${fact.id} cannot reference itself as ${reference}`); }
    if (fact.status === 'current') { if (currentByKey.has(fact.key)) throw new Error(`multiple current authoritative facts for key: ${fact.key}`); if (fact.supersededBy || fact.correctedBy || fact.revokedAt) throw new Error(`current fact ${fact.id} contains historical-only linkage`); currentByKey.set(fact.key, fact); }
    if (fact.status === 'revoked' && !fact.revokedAt) throw new Error(`revoked fact ${fact.id} requires revokedAt`);
    if (fact.status === 'superseded' && !fact.supersededBy) throw new Error(`superseded fact ${fact.id} requires supersededBy`);
    if (fact.status === 'corrected' && !fact.correctedBy) throw new Error(`corrected fact ${fact.id} requires correctedBy`);
  }
  for (const fact of items) {
    const successorId = fact.status === 'superseded' ? fact.supersededBy : fact.status === 'corrected' ? fact.correctedBy : undefined;
    if (successorId) { const successor = byId.get(successorId); if (successor.key !== fact.key) throw new Error(`fact lineage key mismatch: ${fact.id} -> ${successor.id}`); if (successor.status !== 'current') throw new Error(`fact successor must be current: ${successor.id}`); if (successor.supersedes !== fact.id) throw new Error(`fact successor ${successor.id} must declare supersedes: ${fact.id}`); }
    if (fact.supersedes) { const predecessor = byId.get(fact.supersedes); if (predecessor.key !== fact.key) throw new Error(`fact lineage key mismatch: ${predecessor.id} -> ${fact.id}`); if (!['superseded', 'corrected'].includes(predecessor.status)) throw new Error(`superseded predecessor must be historical: ${predecessor.id}`); if (![predecessor.supersededBy, predecessor.correctedBy].includes(fact.id)) throw new Error(`fact predecessor ${predecessor.id} does not point to successor ${fact.id}`); }
  }
  return items;
}

function currentFacts(facts, { key, includeHistorical = false, includeTentative = false } = {}) { const selected = facts.filter((fact) => { if (key !== undefined && fact.key !== key) return false; if (fact.status === 'tentative') return includeTentative; if (fact.status === 'current') return true; return includeHistorical; }); return Object.freeze(structuredClone(selected)); }

function requiredFactPermission(mission, actor, action) {
  const actorId = requiredId(actor, 'fact operation actor');
  const permission = (mission.permissions ?? []).find((entry) => entry.actor === actorId);
  if (!permission || !Array.isArray(permission.actions) || !permission.actions.includes(action)) {
    throw new Error(`actor ${actorId} lacks required permission: ${action}`);
  }
  return Object.freeze({ actor: actorId, actions: Object.freeze([...permission.actions]), granted: true });
}

function currentFactById(mission, factId) {
  const id = requiredId(factId, 'fact id');
  const fact = (mission.authoritativeFacts ?? []).find((entry) => entry.id === id);
  if (!fact) throw new Error(`authoritative fact not found: ${id}`);
  if (fact.status !== 'current') throw new Error(`authoritative fact is not current: ${id}`);
  return fact;
}

function successorInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('successor must be an object');
  const keys = Object.keys(value);
  for (const key of keys) if (!['id', 'value'].includes(key)) throw new Error(`unsupported successor field: ${key}`);
  if (!Object.hasOwn(value, 'value')) throw new TypeError('successor value is required');
  return Object.freeze({ id: requiredId(value.id, 'successor id'), value: structuredClone(value.value) });
}

function recordableFact(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('fact must be an object');
  const fact = normalizeFact(value);
  if (!['current', 'tentative'].includes(fact.status)) throw new Error('recordFact accepts only current or tentative facts');
  if (fact.supersedes || fact.supersededBy || fact.correctedBy || fact.revokedAt) throw new Error('new facts cannot declare historical lineage');
  return fact;
}
function authoritativeState(input) {
  const goals = validateGoals(input.goals);
  const goalIds = new Set(goals.map(({ id }) => id));
  const { items: subgoals, ids: subgoalIds } = validateSubgoals(input.subgoals, goalIds);
  const currentPlan = validatePlan(input.currentPlan, subgoalIds);
  const dependencies = validateDependencies(input.dependencies, subgoalIds, goalIds);
  const workflowGraph = buildWorkflowGraph({ goals, subgoals, dependencies, currentPlan });
  return Object.freeze({
    objective: requiredText(input.objective, 'objective'),
    goals,
    subgoals,
    dependencies,
    workflowGraph,
    completedWork: Object.freeze([]),
    pendingWork: Object.freeze([...currentPlan.steps]),
    failedWork: Object.freeze([]),
    evidence: Object.freeze([]),
    constraints: stringArray(input.constraints, 'constraints'),
    permissions: validatePermissions(input.permissions),
    activeAgents: Object.freeze([]),
    artifactReferences: Object.freeze([]),
    currentPlan,
    environmentObservations: validateObservations(input.environmentObservations),
    authoritativeFacts: validateFacts(input.authoritativeFacts ?? []),
    checkpoints: Object.freeze([]),
    branches: Object.freeze([]),
    activeBranchId: 'main',
    executionTrace: Object.freeze([]),
    epistemicClaims: Object.freeze([]),
  });
}

function workflowGraphFor(mission) {
  if (mission?.workflowGraph && typeof mission.workflowGraph === 'object') return mission.workflowGraph;
  return buildWorkflowGraph({
    goals: mission?.goals ?? [],
    subgoals: mission?.subgoals ?? [],
    dependencies: mission?.dependencies ?? [],
    currentPlan: mission?.currentPlan,
  });
}

function validateUpdate(update, mission) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) throw new TypeError('state update must be an object');
  if (Object.hasOwn(update, 'authoritativeFacts')) throw new Error('authoritativeFacts must be changed through atomic fact operations');
  for (const field of Object.keys(update)) {
    if (field === 'workflowGraph') throw new Error('workflowGraph is immutable after create');
    if (field === 'checkpoints' || field === 'branches' || field === 'activeBranchId') {
      throw new Error(`${field} must be changed through recovery checkpoint operations`);
    }
    if (field === 'executionTrace') {
      throw new Error('executionTrace must be changed through mission observability');
    }
    if (field === 'memory') {
      authorizeMemoryWrite({ writer: 'caller' });
      throw new Error('memory must not be mutated through transition; typed memory is a projection');
    }
    if (field === 'epistemicClaims') {
      throw new Error('epistemicClaims must be changed through epistemic operations');
    }
    if (field === 'learnedKnowledge' || field === 'learningPipeline') {
      throw new Error('learnedKnowledge must be changed through the gated learning pipeline');
    }
    if (field === 'skillLibrary' || field === 'skills') {
      throw new Error('skillLibrary must be changed through the validated skill library');
    }
    if (field === 'selfImprovement' || field === 'improvementSandbox') {
      throw new Error('selfImprovement must be changed through the self-improvement sandbox');
    }
    if (field === 'distributedState' || field === 'replicas' || field === 'stateEventLog') {
      throw new Error('distributedState must be changed through the distributed state layer');
    }
    if (!MUTABLE_FIELDS.has(field)) throw new Error(`unsupported authoritative state field: ${field}`);
  }
  const validated = {};
  for (const field of ['completedWork', 'pendingWork', 'failedWork', 'constraints', 'activeAgents']) {
    if (Object.hasOwn(update, field)) validated[field] = stringArray(update[field], field);
  }
  for (const field of ['evidence', 'artifactReferences', 'environmentObservations']) {
    if (Object.hasOwn(update, field)) {
      validated[field] = field === 'environmentObservations'
        ? validateObservations(update[field])
        : records(update[field], field);
    }
  }
  if (Object.hasOwn(update, 'goals') || Object.hasOwn(update, 'subgoals') || Object.hasOwn(update, 'dependencies') || Object.hasOwn(update, 'currentPlan')) {
    throw new Error('mission graph and currentPlan are immutable in this service version');
  }
  const subgoalIds = new Set(mission.subgoals?.map(({ id }) => id) ?? []);
  const partitions = ['completedWork', 'pendingWork', 'failedWork'].map((field) => [field, validated[field] ?? mission[field] ?? []]);
  const assigned = new Map();
  for (const [, workIds] of partitions) {
    for (const id of workIds) {
      if (!subgoalIds.has(id)) throw new Error(`work references unknown subgoal: ${id}`);
      if (assigned.has(id)) throw new Error(`work partitions overlap: ${id}`);
      assigned.set(id, true);
    }
  }
  const permittedActors = new Set((mission.permissions ?? []).map(({ actor }) => actor));
  for (const agent of validated.activeAgents ?? mission.activeAgents ?? []) {
    if (!permittedActors.has(agent)) throw new Error(`active agent lacks mission permission: ${agent}`);
  }
  // Item 11: every work-partition mutation must keep execution on a valid path.
  if (Object.hasOwn(validated, 'completedWork') || Object.hasOwn(validated, 'pendingWork') || Object.hasOwn(validated, 'failedWork')) {
    assertValidMissionPath({
      workflowGraph: workflowGraphFor(mission),
      completedWork: validated.completedWork ?? mission.completedWork ?? [],
      pendingWork: validated.pendingWork ?? mission.pendingWork ?? [],
      failedWork: validated.failedWork ?? mission.failedWork ?? [],
    });
  }
  return Object.freeze(validated);
}

export function createMissionStateService({
  root,
  clock = () => new Date().toISOString(),
  store = { loadMission, saveMission },
  identities = createAgentIdentityRegistry(),
  learning = null,
  skills = null,
  improvement = null,
  distributed = null,
  durableReplicaDir = null,
  operationRetryTimeoutMs = OPERATION_RETRY_TIMEOUT_MS,
  operationRetryDelayMs = OPERATION_RETRY_DELAY_MS,
} = {}) {
  requiredText(root, 'root'); if (typeof clock !== 'function') throw new TypeError('clock must be a function'); if (typeof store?.loadMission !== 'function' || typeof store?.saveMission !== 'function') throw new TypeError('store must provide loadMission and saveMission');
  identities = identities ?? createAgentIdentityRegistry();
  if (!isBrandedAgentIdentityRegistry(identities)) {
    throw new TypeError('identities must be a branded agentIdentityRegistry from createAgentIdentityRegistry');
  }
  learning = learning ?? createGatedLearningPipeline({ now: clock, identities });
  if (!isBrandedGatedLearningPipeline(learning)) {
    throw new TypeError('learning must be a branded gatedLearningPipeline from createGatedLearningPipeline');
  }
  if (getGatedLearningIdentities(learning) !== identities) {
    throw new TypeError('learning identities must be the same registry instance as service identities');
  }
  if (typeof learning.runPipeline !== 'function' || typeof learning.storePermanent !== 'function') {
    throw new TypeError('learning pipeline must provide runPipeline and storePermanent');
  }
  const skillLibrary = skills ?? createValidatedSkillLibrary({ learning, now: clock });
  if (!isBrandedValidatedSkillLibrary(skillLibrary)) {
    throw new TypeError('skills must be a branded validatedSkillLibrary from createValidatedSkillLibrary');
  }
  if (getValidatedSkillLearning(skillLibrary) !== learning) {
    throw new TypeError('skills learning must be the same pipeline instance as service learning');
  }
  if (typeof skillLibrary.reuse !== 'function' || typeof skillLibrary.publishFromLesson !== 'function') {
    throw new TypeError('skills library must provide reuse and publishFromLesson');
  }
  improvement = improvement ?? createSelfImprovementSandbox({ now: clock, identities });
  if (!isBrandedSelfImprovementSandbox(improvement)) {
    throw new TypeError('improvement must be a branded selfImprovementSandbox from createSelfImprovementSandbox');
  }
  if (getSelfImprovementIdentities(improvement) !== identities) {
    throw new TypeError('improvement identities must be the same registry instance as service identities');
  }
  if (typeof improvement.runPipeline !== 'function' || typeof improvement.deployToProduction !== 'function') {
    throw new TypeError('improvement sandbox must provide runPipeline and deployToProduction');
  }
  const distributedLayer = distributed === true
    ? createDistributedMissionStore({
      primary: store,
      now: clock,
      ...(durableReplicaDir == null ? {} : { durableReplicaDir }),
    })
    : distributed;
  if (distributedLayer != null) {
    if (!isBrandedDistributedMissionStore(distributedLayer)) {
      throw new TypeError('distributed must be true or a branded distributedMissionStore from createDistributedMissionStore');
    }
    if (typeof distributedLayer.loadMission !== 'function' || typeof distributedLayer.saveMission !== 'function') {
      throw new TypeError('distributed layer must provide loadMission and saveMission');
    }
    if (typeof distributedLayer.loadMissionReplica !== 'function' || typeof distributedLayer.topology !== 'function') {
      throw new TypeError('distributed layer must provide loadMissionReplica and topology');
    }
  }
  store = distributedLayer ?? store;
  function assertRegisteredIdentityActive(actorId) {
    identities.assertActive(actorId);
  }
  const retryTimeoutMs = boundedInteger(operationRetryTimeoutMs, 'operationRetryTimeoutMs', { min: 1, max: 60_000 });
  const retryDelayMs = boundedInteger(operationRetryDelayMs, 'operationRetryDelayMs', { min: 1, max: retryTimeoutMs });
  async function saveOperation({ mission, expectedRevision, operationId, operationHash }) {
    const deadline = Date.now() + retryTimeoutMs;
    const retryOrThrow = async (saveError) => {
      if (saveError?.message !== 'mission write already in progress') throw saveError;
      if (Date.now() >= deadline) {
        throw new Error(`operation retry timed out after ${retryTimeoutMs}ms`, { cause: saveError });
      }
      await delay(retryDelayMs);
    };
    for (;;) {
      let saveError;
      try {
        return await store.saveMission({ root, mission, ...(expectedRevision === undefined ? {} : { expectedRevision }) });
      } catch (error) {
        saveError = error;
      }
      let current;
      try {
        current = await store.loadMission({ root, missionId: mission.id });
      } catch {
        await retryOrThrow(saveError);
        continue;
      }
      const prior = (current.mission.transitionHistory ?? []).find((entry) => entry.operationId === operationId);
      if (prior) {
        if (prior.operationHash !== operationHash) {
          throw new Error(`idempotency conflict: operation id already has different content: ${operationId}`);
        }
        return Object.freeze({ ...current, duplicate: true, operationVersion: prior.stateVersion });
      }
      await retryOrThrow(saveError);
    }
  }

  async function commitFactOperation({ operationId, missionId, expectedRevision, actor, action, evidence, input, mutate }) {
    const id = requiredId(missionId, 'mission id');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new TypeError('revision conflict: expectedRevision must be a positive integer');
    const operation = requiredId(operationId, 'operation id');
    const current = await store.loadMission({ root, missionId: id });
    const existingHistory = current.mission.transitionHistory ?? [];
    const history = existingHistory.length > 0 ? existingHistory : [legacyImportRecord(current.mission, current.revision, clock())];
    const operationHashInput = { actor, action, input, evidence: evidence ?? null };
    const prior = history.find((entry) => entry.operationId === operation);
    if (prior) {
      if (prior.operationHash !== hashValue(operationHashInput)) throw new Error(`idempotency conflict: operation id already has different content: ${operation}`);
      return Object.freeze({ ...current, duplicate: true, operationVersion: prior.stateVersion });
    }
    const authorization = requiredFactPermission(current.mission, actor, action);
    assertRegisteredIdentityActive(authorization.actor);
    const timestamp = clock();
    const authoritativeFacts = validateFacts(mutate(current.mission, timestamp));
    const nextState = Object.freeze({ ...current.mission, authoritativeFacts, updatedAt: timestamp });
    const lineage = transitionRecord({
      stateVersion: expectedRevision + 1,
      previousVersion: expectedRevision,
      previousTransitionHash: history.at(-1).transitionHash,
      operationId: operation,
      operationHashInput,
      actor: authorization.actor,
      action,
      timestamp,
      input,
      before: current.mission,
      after: nextState,
      authorization,
      evidence,
    });
    const mission = withAppendedTrace(
      Object.freeze({ ...nextState, transitionHistory: Object.freeze([...history, lineage]) }),
      lineage,
    );
    return saveOperation({ mission, expectedRevision, operationId: operation, operationHash: hashValue(operationHashInput) });
  }

  async function commitEpistemicOperation({ operationId, missionId, expectedRevision, actor, action, input, mutate }) {
    const id = requiredId(missionId, 'mission id');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new TypeError('revision conflict: expectedRevision must be a positive integer');
    }
    const operation = requiredId(operationId, 'operation id');
    const current = await store.loadMission({ root, missionId: id });
    const existingHistory = current.mission.transitionHistory ?? [];
    const history = existingHistory.length > 0
      ? existingHistory
      : [legacyImportRecord(current.mission, current.revision, clock())];
    const operationHashInput = { actor, action, input };
    const prior = history.find((entry) => entry.operationId === operation);
    if (prior) {
      if (prior.operationHash !== hashValue(operationHashInput)) {
        throw new Error(`idempotency conflict: operation id already has different content: ${operation}`);
      }
      return Object.freeze({ ...current, duplicate: true, operationVersion: prior.stateVersion });
    }
    const authorization = requiredFactPermission(current.mission, actor, action);
    assertRegisteredIdentityActive(authorization.actor);
    const timestamp = clock();
    const epistemicClaims = Object.freeze(mutate(current.mission, timestamp));
    if (epistemicClaims.length > EPISTEMIC_MAX_CLAIMS) {
      throw new Error(`epistemicClaims exceed cap (${EPISTEMIC_MAX_CLAIMS})`);
    }
    assessEpistemicState(epistemicClaims);
    const nextState = Object.freeze({ ...current.mission, epistemicClaims, updatedAt: timestamp });
    const lineage = transitionRecord({
      stateVersion: expectedRevision + 1,
      previousVersion: expectedRevision,
      previousTransitionHash: history.at(-1).transitionHash,
      operationId: operation,
      operationHashInput,
      actor: authorization.actor,
      action,
      timestamp,
      input,
      before: current.mission,
      after: nextState,
      authorization,
    });
    const mission = withAppendedTrace(
      Object.freeze({ ...nextState, transitionHistory: Object.freeze([...history, lineage]) }),
      lineage,
    );
    return saveOperation({
      mission,
      expectedRevision,
      operationId: operation,
      operationHash: hashValue(operationHashInput),
    });
  }

  async function commitRecoveryOperation({
    operationId,
    missionId,
    expectedRevision,
    envelope,
    action,
    input,
    mutate,
    resumeFromBlocked = false,
  }) {
    const id = requiredId(missionId, 'mission id');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new TypeError('revision conflict: expectedRevision must be a positive integer');
    }
    const operation = requiredId(operationId, 'operation id');
    const current = await store.loadMission({ root, missionId: id });
    const existingHistory = current.mission.transitionHistory ?? [];
    const history = existingHistory.length > 0
      ? existingHistory
      : [legacyImportRecord(current.mission, current.revision, clock())];
    const signalType = resumeFromBlocked && current.mission.status === 'blocked' ? 'running' : undefined;
    const authorization = authorizeAgentOperation({
      envelope,
      mission: current.mission,
      expectedRevision,
      operationId: operation,
      signalType,
    });
    if (authorization.action !== action) {
      throw new Error(`recovery action mismatch: expected ${action}`);
    }
    const authorizedAgentId = authorization.envelope.agent_id;
    identities.assertActive(authorizedAgentId);
    const operationHashInput = { envelope: authorization.envelope, action, input };
    const prior = history.find((entry) => entry.operationId === operation);
    if (prior) {
      if (prior.operationHash !== hashValue(operationHashInput)) {
        throw new Error(`idempotency conflict: operation id already has different content: ${operation}`);
      }
      return Object.freeze({ ...current, duplicate: true, operationVersion: prior.stateVersion });
    }
    if (
      (action === 'rollback_to_checkpoint' || action === 'retry_from_checkpoint')
      && current.mission.status === 'completed'
    ) {
      throw new Error('cannot rollback or retry a completed mission');
    }
    if (
      (action === 'rollback_to_checkpoint' || action === 'retry_from_checkpoint')
      && current.mission.status !== 'blocked'
    ) {
      throw new Error('can only rollback or retry from a blocked mission');
    }
    const timestamp = clock();
    let nextState = mutate(current.mission, authorization, timestamp);
    assertValidMissionPath({
      workflowGraph: workflowGraphFor(nextState),
      completedWork: nextState.completedWork ?? [],
      pendingWork: nextState.pendingWork ?? [],
      failedWork: nextState.failedWork ?? [],
    });
    if (signalType === 'running') {
      const resumed = transitionMission(current.mission, {
        type: 'running',
        agent: authorizedAgentId,
        detail: typeof input?.detail === 'string' ? input.detail : 'resumed from verified checkpoint',
      }, { clock: () => timestamp });
      nextState = Object.freeze({
        ...resumed,
        completedWork: nextState.completedWork,
        pendingWork: nextState.pendingWork,
        failedWork: nextState.failedWork,
        evidence: nextState.evidence,
        artifactReferences: nextState.artifactReferences,
        activeAgents: nextState.activeAgents,
        environmentObservations: nextState.environmentObservations,
        checkpoints: nextState.checkpoints,
        branches: nextState.branches,
        activeBranchId: nextState.activeBranchId,
        executionTrace: nextState.executionTrace ?? current.mission.executionTrace ?? [],
        updatedAt: timestamp,
      });
    } else {
      nextState = Object.freeze({ ...nextState, updatedAt: timestamp });
    }
    const lineage = transitionRecord({
      stateVersion: expectedRevision + 1,
      previousVersion: expectedRevision,
      previousTransitionHash: history.at(-1).transitionHash,
      operationId: operation,
      operationHashInput,
      actor: authorizedAgentId,
      action,
      timestamp,
      input: operationHashInput,
      before: current.mission,
      after: nextState,
      authorization: { actor: authorizedAgentId, actions: authorization.permission.actions, granted: true },
    });
    const mission = withAppendedTrace(
      Object.freeze({ ...nextState, transitionHistory: Object.freeze([...history, lineage]) }),
      lineage,
    );
    return saveOperation({
      mission,
      expectedRevision,
      operationId: operation,
      operationHash: hashValue(operationHashInput),
    });
  }

  return Object.freeze({
    async create(input) {
      const id = requiredId(input?.id, 'mission id');
      const operation = requiredId(input?.operationId, 'operation id');
      const state = authoritativeState(input);
      const created = Object.freeze({ ...createMission({ id, intent: state.objective, clock }), ...state });
      const lineage = transitionRecord({
        stateVersion: 1,
        previousVersion: 0,
        previousTransitionHash: null,
        operationId: operation,
        actor: 'titan',
        action: 'create',
        timestamp: created.createdAt,
        input: state,
        before: Object.freeze({ id }),
        after: created,
        authorization: { actor: 'titan', actions: ['create_mission'], granted: true },
      });
      const mission = withAppendedTrace(
        Object.freeze({ ...created, transitionHistory: Object.freeze([lineage]) }),
        lineage,
      );
      return saveOperation({ mission, operationId: operation, operationHash: hashValue(state) });
    },
    async transition({ operationId, missionId, expectedRevision, signal, update = {}, envelope, observability = null }) {
      const id = requiredId(missionId, 'mission id');
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new TypeError('revision conflict: expectedRevision must be a positive integer');
      const operation = requiredId(operationId, 'operation id');
      const current = await store.loadMission({ root, missionId: id });
      const existingHistory = current.mission.transitionHistory ?? [];
      const history = existingHistory.length > 0 ? existingHistory : [legacyImportRecord(current.mission, current.revision, clock())];
      const stateUpdate = validateUpdate(update, current.mission);
      const authorization = authorizeAgentOperation({ envelope, mission: current.mission, expectedRevision, operationId: operation, signalType: signal?.type });
      const authorizedAgentId = authorization.envelope.agent_id;
      identities.assertActive(authorizedAgentId);
      if (signal?.agent !== authorizedAgentId) {
        throw new Error(`signal agent ${signal?.agent ?? '<missing>'} does not match envelope agent_id ${authorizedAgentId}`);
      }
      // Independence is decided from the service-written ledger: the authorized envelope
      // agent against the recorded actors of this mission's performance transitions.
      // Caller-supplied evidence, results, and artifact references are not identity sources.
      authorizeCompletedWorkClaim({
        agentId: authorizedAgentId,
        transitionHistory: history,
        update: stateUpdate,
        signalType: signal?.type,
        mission: current.mission,
      });
      const input = { envelope: authorization.envelope, signal, update: stateUpdate };
      const prior = history.find((entry) => entry.operationId === operation);
      if (prior) {
        if (prior.operationHash !== hashValue(input)) throw new Error(`idempotency conflict: operation id already has different content: ${operation}`);
        return Object.freeze({ ...current, duplicate: true, operationVersion: prior.stateVersion });
      }
      if (signal?.type === 'completed') {
        const verification = await verifyProof({ root, ref: signal.proof });
        if (verification.verified !== true) throw new Error(`completion proof verification failed: ${verification.reason ?? 'unknown'}`);
        // Item 10: layered QR18 is evaluated from the authoritative mission snapshot
        // (current state + validated update) and the service-verified proof. Caller
        // qr18 bags are ignored — evaluateQr18Layers is the authority.
        const proposedMission = Object.freeze({ ...current.mission, ...stateUpdate });
        const qr18 = evaluateQr18Layers({
          mission: proposedMission,
          proofVerification: verification,
          certifierAgentId: authorizedAgentId,
          transitionHistory: history,
        });
        assertQr18LayersVerified(qr18);
        signal = Object.freeze({
          ...signal,
          result: Object.freeze({
            ...(signal.result && typeof signal.result === 'object' && !Array.isArray(signal.result)
              ? signal.result
              : {}),
            auditorVerification: verification,
            qr18,
          }),
        });
      }
      const transitioned = transitionMission(current.mission, signal, { clock });
      const nextState = Object.freeze({ ...transitioned, ...stateUpdate });
      const lineage = transitionRecord({
        stateVersion: expectedRevision + 1,
        previousVersion: expectedRevision,
        previousTransitionHash: history.at(-1).transitionHash,
        operationId: operation,
        actor: authorizedAgentId,
        action: authorization.action,
        timestamp: nextState.updatedAt,
        input,
        before: current.mission,
        after: nextState,
        authorization: { actor: authorizedAgentId, actions: authorization.permission.actions, granted: true },
        evidence: signal.evidence,
      });
      const mission = withAppendedTrace(
        Object.freeze({ ...nextState, transitionHistory: Object.freeze([...history, lineage]) }),
        lineage,
        observability,
      );
      return saveOperation({ mission, expectedRevision, operationId: operation, operationHash: hashValue(input) });
    },
    async reconstruct({ missionId }) {
      const record = await store.loadMission({ root, missionId: requiredId(missionId, 'mission id') });
      return reconstructFailedMission(record.mission);
    },
    async memory({ missionId, types, reader } = {}) {
      const record = await store.loadMission({ root, missionId: requiredId(missionId, 'mission id') });
      return projectMissionMemory(record.mission, {
        reader,
        ...(types === undefined ? {} : { types }),
      });
    },
    async retrieveMemory({ missionId, reader, query, types, limit } = {}) {
      const record = await store.loadMission({ root, missionId: requiredId(missionId, 'mission id') });
      const projected = await this.memory({
        missionId,
        reader,
        ...(types === undefined ? {} : { types }),
      });
      return retrieveStateAwareMemory({
        mission: record.mission,
        projected,
        reader,
        query,
        ...(limit === undefined ? {} : { limit }),
      });
    },
    async decideNext({ missionId, actor = 'mission-state-service', budget } = {}) {
      assertExecutiveActor(actor);
      const record = await store.loadMission({ root, missionId: requiredId(missionId, 'mission id') });
      return decideNext({
        mission: record.mission,
        actor,
        ...(budget === undefined ? {} : { budget }),
      });
    },
    async recordEpistemicClaim({ operationId, missionId, expectedRevision, actor, claim }) {
      const normalized = normalizeEpistemicClaim(claim);
      const actorId = requiredId(actor, 'epistemic actor');
      const role = roleForAgent(actorId);
      if (role === 'executor' && (normalized.polarity === 'verified_true' || normalized.polarity === 'verified_false')) {
        throw new Error(`unauthorized epistemic: executor cannot record ${normalized.polarity}`);
      }
      return commitEpistemicOperation({
        operationId,
        missionId,
        expectedRevision,
        actor: actorId,
        action: 'record_epistemic_claim',
        input: { claim: normalized },
        mutate(mission) {
          const existing = mission.epistemicClaims ?? [];
          if (existing.some((entry) => entry.id === normalized.id)) {
            throw new Error(`duplicate epistemic claim id: ${normalized.id}`);
          }
          return Object.freeze([...existing, normalized]);
        },
      });
    },
    async assessUncertainty({ missionId }) {
      const record = await store.loadMission({ root, missionId: requiredId(missionId, 'mission id') });
      return assessEpistemicState(record.mission.epistemicClaims ?? []);
    },
    async authorityFor({ missionId, operationId }) {
      const record = await store.loadMission({ root, missionId: requiredId(missionId, 'mission id') });
      const history = record.mission.transitionHistory ?? [];
      const entry = history.find((item) => item?.operationId === operationId);
      if (!entry) throw new Error(`unknown operation: ${operationId}`);
      const identity = identities.get(entry.actor);
      const answered = resolveAuthorityFromHistory({
        transitionHistory: history,
        operationId,
        identity,
      });
      return Object.freeze({
        ...answered,
        missionId: record.mission.id,
        revision: record.revision,
      });
    },
    async agentAuditHistory({ missionId, agentId }) {
      const id = requiredId(agentId, 'agent id');
      identities.get(id);
      const record = await store.loadMission({ root, missionId: requiredId(missionId, 'mission id') });
      const history = record.mission.transitionHistory ?? [];
      return Object.freeze(history
        .filter((entry) => entry?.actor === id && entry?.authorization?.granted === true)
        .map((entry) => Object.freeze({
          operationId: entry.operationId,
          action: entry.action ?? null,
          stateVersion: entry.stateVersion,
          timestamp: entry.timestamp,
          identityFingerprint: identities.get(id).identityFingerprint,
        })));
    },
    async storeLearningPermanent(payload) {
      return learning.storePermanent(payload);
    },
    async runLearningPipeline(input) {
      return learning.runPipeline(input);
    },
    listPermanentLearning() {
      return learning.listPermanent();
    },
    async publishSkillFromLesson(input) {
      return skillLibrary.publishFromLesson(input);
    },
    async reuseSkill(input) {
      return skillLibrary.reuse(input);
    },
    listSkills() {
      return skillLibrary.list();
    },
    async runImprovementPipeline(input) {
      return improvement.runPipeline(input);
    },
    async deployImprovementToProduction(payload) {
      return improvement.deployToProduction(payload);
    },
    listImprovementProposals() {
      return improvement.list();
    },
    distributedTopology() {
      if (distributedLayer == null) throw new Error('distributed state layer not configured');
      return distributedLayer.topology();
    },
    async loadMissionReplica(input) {
      if (distributedLayer == null) throw new Error('distributed state layer not configured');
      return distributedLayer.loadMissionReplica({ ...input, root });
    },
    listMissionStateEvents(input = {}) {
      if (distributedLayer == null) throw new Error('distributed state layer not configured');
      return distributedLayer.listStateEvents(input);
    },
    resolveMissionShard(missionId) {
      if (distributedLayer == null) throw new Error('distributed state layer not configured');
      return distributedLayer.resolveShard(missionId);
    },
    async recordFact({ operationId, missionId, expectedRevision, actor, fact, evidence }) {
      const normalized = recordableFact(fact);
      return commitFactOperation({
        operationId, missionId, expectedRevision, actor, action: 'record_fact', evidence,
        input: { fact: normalized },
        mutate(mission) {
          const facts = mission.authoritativeFacts ?? [];
          if (facts.some((entry) => entry.id === normalized.id)) throw new Error(`duplicate fact id: ${normalized.id}`);
          if (normalized.status === 'current' && facts.some((entry) => entry.key === normalized.key && entry.status === 'current')) {
            throw new Error(`current fact already exists for key ${normalized.key}; supersede or correct it explicitly`);
          }
          return [...facts, normalized];
        },
      });
    },
    async supersedeFact({ operationId, missionId, expectedRevision, actor, factId, successor, reason, evidence }) {
      const next = successorInput(successor);
      const why = requiredText(reason, 'supersession reason');
      return commitFactOperation({
        operationId, missionId, expectedRevision, actor, action: 'supersede_fact', evidence,
        input: { factId: requiredId(factId, 'fact id'), successor: next, reason: why },
        mutate(mission) {
          const predecessor = currentFactById(mission, factId);
          if ((mission.authoritativeFacts ?? []).some((entry) => entry.id === next.id)) throw new Error(`duplicate fact id: ${next.id}`);
          return (mission.authoritativeFacts ?? []).map((entry) => entry.id === predecessor.id
            ? { ...entry, status: 'superseded', supersededBy: next.id, reason: why }
            : entry).concat({ id: next.id, key: predecessor.key, value: next.value, status: 'current', supersedes: predecessor.id });
        },
      });
    },
    async correctFact({ operationId, missionId, expectedRevision, actor, factId, successor, reason, evidence }) {
      const next = successorInput(successor);
      const why = requiredText(reason, 'correction reason');
      return commitFactOperation({
        operationId, missionId, expectedRevision, actor, action: 'correct_fact', evidence,
        input: { factId: requiredId(factId, 'fact id'), successor: next, reason: why },
        mutate(mission) {
          const predecessor = currentFactById(mission, factId);
          if ((mission.authoritativeFacts ?? []).some((entry) => entry.id === next.id)) throw new Error(`duplicate fact id: ${next.id}`);
          return (mission.authoritativeFacts ?? []).map((entry) => entry.id === predecessor.id
            ? { ...entry, status: 'corrected', correctedBy: next.id, reason: why }
            : entry).concat({ id: next.id, key: predecessor.key, value: next.value, status: 'current', supersedes: predecessor.id });
        },
      });
    },
    async revokeFact({ operationId, missionId, expectedRevision, actor, factId, reason, evidence }) {
      const why = requiredText(reason, 'revocation reason');
      return commitFactOperation({
        operationId, missionId, expectedRevision, actor, action: 'revoke_fact', evidence,
        input: { factId: requiredId(factId, 'fact id'), reason: why },
        mutate(mission, timestamp) {
          const predecessor = currentFactById(mission, factId);
          return (mission.authoritativeFacts ?? []).map((entry) => entry.id === predecessor.id
            ? { ...entry, status: 'revoked', revokedAt: timestamp, reason: why }
            : entry);
        },
      });
    },
    async createCheckpoint({ operationId, missionId, expectedRevision, label, envelope }) {
      const checkpointLabel = requiredText(label, 'checkpoint label');
      return commitRecoveryOperation({
        operationId,
        missionId,
        expectedRevision,
        envelope,
        action: 'create_checkpoint',
        input: { label: checkpointLabel },
        mutate(mission, authorization, timestamp) {
          const existing = mission.checkpoints ?? [];
          if (existing.length >= MAX_CHECKPOINTS) {
            throw new Error(`checkpoints exceed cap (${MAX_CHECKPOINTS})`);
          }
          const checkpointId = `cp-${hashValue({ operationId, missionId: mission.id, label: checkpointLabel }).slice(0, 24)}`;
          if (existing.some((entry) => entry.id === checkpointId)) {
            throw new Error(`duplicate checkpoint id: ${checkpointId}`);
          }
          const checkpoint = buildCheckpointRecord({
            id: checkpointId,
            label: checkpointLabel,
            revision: expectedRevision,
            actor: authorization.envelope.agent_id,
            createdAt: timestamp,
            mission,
          });
          const checkpoints = Object.freeze([...existing, checkpoint]);
          assertCheckpointCap(checkpoints);
          return Object.freeze({
            ...mission,
            checkpoints,
          });
        },
      });
    },
    async createBranch({ operationId, missionId, expectedRevision, checkpointId, strategy, envelope }) {
      const fromCheckpointId = requiredId(checkpointId, 'checkpoint id');
      const branchStrategy = requiredText(strategy, 'branch strategy');
      return commitRecoveryOperation({
        operationId,
        missionId,
        expectedRevision,
        envelope,
        action: 'create_branch',
        input: { checkpointId: fromCheckpointId, strategy: branchStrategy },
        mutate(mission, authorization, timestamp) {
          const checkpoint = findCheckpoint(mission, fromCheckpointId);
          assertCheckpointIntegrity(checkpoint);
          const branchId = `br-${hashValue({ operationId, missionId: mission.id, fromCheckpointId }).slice(0, 24)}`;
          if ((mission.branches ?? []).some((entry) => entry.id === branchId)) {
            throw new Error(`duplicate branch id: ${branchId}`);
          }
          const branch = buildBranchRecord({
            id: branchId,
            checkpointId: fromCheckpointId,
            strategy: branchStrategy,
            actor: authorization.envelope.agent_id,
            createdAt: timestamp,
          });
          return Object.freeze({
            ...mission,
            branches: Object.freeze([...(mission.branches ?? []), branch]),
            activeBranchId: branchId,
          });
        },
      });
    },
    async quarantineBranch({ operationId, missionId, expectedRevision, branchId, reason, envelope }) {
      const id = requiredId(branchId, 'branch id');
      const why = requiredText(reason, 'quarantine reason');
      return commitRecoveryOperation({
        operationId,
        missionId,
        expectedRevision,
        envelope,
        action: 'quarantine_branch',
        input: { branchId: id, reason: why },
        mutate(mission) {
          findBranch(mission, id);
          const branches = (mission.branches ?? []).map((entry) => (
            entry.id === id
              ? Object.freeze({ ...entry, status: 'quarantined', reason: why })
              : entry
          ));
          const activeBranchId = mission.activeBranchId === id ? 'main' : mission.activeBranchId;
          return Object.freeze({
            ...mission,
            branches: Object.freeze(branches),
            activeBranchId,
          });
        },
      });
    },
    async rollbackToCheckpoint({ operationId, missionId, expectedRevision, checkpointId, envelope }) {
      const id = requiredId(checkpointId, 'checkpoint id');
      return commitRecoveryOperation({
        operationId,
        missionId,
        expectedRevision,
        envelope,
        action: 'rollback_to_checkpoint',
        input: { checkpointId: id, detail: 'rollback to verified checkpoint' },
        resumeFromBlocked: true,
        mutate(mission, authorization, timestamp) {
          const checkpoint = findCheckpoint(mission, id);
          return applyCheckpointSnapshot(mission, checkpoint, {
            resyncObservation: {
              source: authorization.envelope.agent_id,
              key: 'environment_resync',
              value: Object.freeze({ checkpointId: id, mode: 'rollback' }),
              observedAt: timestamp,
            },
          });
        },
      });
    },
    async retryFromCheckpoint({ operationId, missionId, expectedRevision, checkpointId, envelope }) {
      const id = requiredId(checkpointId, 'checkpoint id');
      return commitRecoveryOperation({
        operationId,
        missionId,
        expectedRevision,
        envelope,
        action: 'retry_from_checkpoint',
        input: { checkpointId: id, detail: 'retry from last known-good checkpoint' },
        resumeFromBlocked: true,
        mutate(mission, authorization, timestamp) {
          const checkpoint = findCheckpoint(mission, id);
          return applyCheckpointSnapshot(mission, checkpoint, {
            resyncObservation: {
              source: authorization.envelope.agent_id,
              key: 'environment_resync',
              value: Object.freeze({ checkpointId: id, mode: 'retry' }),
              observedAt: timestamp,
            },
          });
        },
      });
    },
    async get({ missionId, includeHistorical = false }) {
      if (typeof includeHistorical !== 'boolean') throw new TypeError('includeHistorical must be a boolean');
      const record = await store.loadMission({ root, missionId: requiredId(missionId, 'mission id') });
      if (includeHistorical) return record;
      const { transitionHistory: ignoredHistory, ...currentMission } = record.mission;
      return Object.freeze({
        ...record,
        mission: Object.freeze({
          ...currentMission,
          authoritativeFacts: currentFacts(record.mission.authoritativeFacts ?? []),
        }),
      });
    },
    async history({ missionId }) { const record = await store.loadMission({ root, missionId: requiredId(missionId, 'mission id') }); return Object.freeze(structuredClone(record.mission.transitionHistory ?? [])); },
    async verifyHistory({ missionId }) { const record = await store.loadMission({ root, missionId: requiredId(missionId, 'mission id') }); return verifyTransitionHistory(record.mission, record.revision); },
    async facts({ missionId, key, includeHistorical = false, includeTentative = false }) { const record = await store.loadMission({ root, missionId: requiredId(missionId, 'mission id') }); const factKey = key === undefined ? undefined : requiredText(key, 'fact key'); if (typeof includeHistorical !== 'boolean') throw new TypeError('includeHistorical must be a boolean'); if (typeof includeTentative !== 'boolean') throw new TypeError('includeTentative must be a boolean'); return currentFacts(record.mission.authoritativeFacts ?? [], { key: factKey, includeHistorical, includeTentative }); },
    async select({ missionId, fields }) { if (!Array.isArray(fields) || fields.length === 0) throw new TypeError('selected state fields must be a non-empty array'); const record = await store.loadMission({ root, missionId: requiredId(missionId, 'mission id') }); const selected = { missionId: record.mission.id, stateVersion: record.revision }; for (const field of fields) { if (!SELECTABLE_FIELDS.has(field)) throw new Error(`unsupported selected state field: ${field}`); selected[field] = field === 'currentFacts' ? currentFacts(record.mission.authoritativeFacts ?? []) : structuredClone(record.mission[field]); } return Object.freeze(selected); },
  });
}
