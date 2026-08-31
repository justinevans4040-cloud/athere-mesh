import { createHash } from 'node:crypto';
import { createMission, transitionMission } from '../../contracts/src/mission.js';
import { loadMission, saveMission } from './mission-store.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const FACT_STATUSES = new Set(['current', 'superseded', 'revoked', 'corrected', 'historical', 'tentative']);
const MUTABLE_FIELDS = new Set([
  'goals', 'subgoals', 'dependencies', 'completedWork', 'pendingWork', 'failedWork', 'evidence',
  'constraints', 'activeAgents', 'artifactReferences', 'currentPlan', 'environmentObservations',
  'authoritativeFacts',
]);
const SELECTABLE_FIELDS = new Set([
  'objective', 'permissions', 'currentFacts',
  ...[...MUTABLE_FIELDS].filter((field) => field !== 'authoritativeFacts'),
]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function stateWithoutHistory(mission) {
  const { transitionHistory: ignored, ...state } = mission;
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

function transitionRecord({ stateVersion, previousVersion, previousTransitionHash, actor, action, timestamp, input, before, after, authorization, evidence }) {
  const changes = stateChanges(before, after);
  const record = {
    transitionId: `${after.id}-transition-${stateVersion}`,
    stateVersion,
    previousVersion,
    previousTransitionHash: previousTransitionHash ?? null,
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
function optionalId(value, label) { return value === undefined ? undefined : requiredId(value, label); }
function optionalIsoTimestamp(value, label) { if (value === undefined) return undefined; const timestamp = requiredText(value, label); if (Number.isNaN(Date.parse(timestamp))) throw new TypeError(`${label} must be an ISO timestamp`); return timestamp; }
function stringArray(value, label) { if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`); return Object.freeze(value.map((item) => requiredText(item, `${label} entry`))); }
function uniqueIds(items, label) { const ids = new Set(); for (const item of items) { const id = requiredId(item?.id, `${label} id`); if (ids.has(id)) throw new Error(`duplicate ${label} id: ${id}`); ids.add(id); } return ids; }
function records(value, label) { if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`); return Object.freeze(value.map((item) => { if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`${label} entry must be an object`); return Object.freeze(structuredClone(item)); })); }
function validateGoals(value) { const items = records(value, 'goals'); uniqueIds(items, 'goal'); for (const item of items) requiredText(item.objective, 'goal objective'); return items; }
function validateSubgoals(value, goalIds) { const items = records(value, 'subgoals'); const ids = uniqueIds(items, 'subgoal'); for (const item of items) { requiredText(item.objective, 'subgoal objective'); if (!goalIds.has(requiredId(item.goalId, 'subgoal goalId'))) throw new Error(`subgoal references unknown goal: ${item.goalId}`); } return { items, ids }; }
function validateDependencies(value, subgoalIds) { const items = records(value, 'dependencies'); for (const item of items) { const prerequisite = requiredId(item.prerequisite, 'dependency prerequisite'); const dependent = requiredId(item.dependent, 'dependency dependent'); if (!subgoalIds.has(prerequisite) || !subgoalIds.has(dependent)) throw new Error('dependency references unknown subgoal'); if (prerequisite === dependent) throw new Error('subgoal cannot depend on itself'); } return items; }
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
function authoritativeState(input) { const goals = validateGoals(input.goals); const { items: subgoals, ids: subgoalIds } = validateSubgoals(input.subgoals, new Set(goals.map(({ id }) => id))); const currentPlan = validatePlan(input.currentPlan, subgoalIds); return Object.freeze({ objective: requiredText(input.objective, 'objective'), goals, subgoals, dependencies: validateDependencies(input.dependencies, subgoalIds), completedWork: Object.freeze([]), pendingWork: Object.freeze([...currentPlan.steps]), failedWork: Object.freeze([]), evidence: Object.freeze([]), constraints: stringArray(input.constraints, 'constraints'), permissions: validatePermissions(input.permissions), activeAgents: Object.freeze([]), artifactReferences: Object.freeze([]), currentPlan, environmentObservations: validateObservations(input.environmentObservations), authoritativeFacts: validateFacts(input.authoritativeFacts ?? []) }); }
function validateUpdate(update, mission) { if (!update || typeof update !== 'object' || Array.isArray(update)) throw new TypeError('state update must be an object'); if (Object.hasOwn(update, 'authoritativeFacts')) throw new Error('authoritativeFacts must be changed through atomic fact operations'); for (const field of Object.keys(update)) if (!MUTABLE_FIELDS.has(field)) throw new Error(`unsupported authoritative state field: ${field}`); const validated = {}; for (const field of ['completedWork', 'pendingWork', 'failedWork', 'constraints', 'activeAgents']) if (Object.hasOwn(update, field)) validated[field] = stringArray(update[field], field); for (const field of ['evidence', 'artifactReferences', 'environmentObservations']) if (Object.hasOwn(update, field)) validated[field] = field === 'environmentObservations' ? validateObservations(update[field]) : records(update[field], field); if (Object.hasOwn(update, 'goals') || Object.hasOwn(update, 'subgoals') || Object.hasOwn(update, 'dependencies') || Object.hasOwn(update, 'currentPlan')) throw new Error('mission graph and currentPlan are immutable in this service version'); const subgoalIds = new Set(mission.subgoals?.map(({ id }) => id) ?? []); const partitions = ['completedWork', 'pendingWork', 'failedWork'].map((field) => [field, validated[field] ?? mission[field] ?? []]); const assigned = new Map(); for (const [, workIds] of partitions) for (const id of workIds) { if (!subgoalIds.has(id)) throw new Error(`work references unknown subgoal: ${id}`); if (assigned.has(id)) throw new Error(`work partitions overlap: ${id}`); assigned.set(id, true); } const permittedActors = new Set((mission.permissions ?? []).map(({ actor }) => actor)); for (const agent of validated.activeAgents ?? mission.activeAgents ?? []) if (!permittedActors.has(agent)) throw new Error(`active agent lacks mission permission: ${agent}`); return Object.freeze(validated); }

export function createMissionStateService({ root, clock = () => new Date().toISOString(), store = { loadMission, saveMission } } = {}) {
  requiredText(root, 'root'); if (typeof clock !== 'function') throw new TypeError('clock must be a function'); if (typeof store?.loadMission !== 'function' || typeof store?.saveMission !== 'function') throw new TypeError('store must provide loadMission and saveMission');
  async function commitFactOperation({ missionId, expectedRevision, actor, action, evidence, input, mutate }) {
    const id = requiredId(missionId, 'mission id');
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new TypeError('revision conflict: expectedRevision must be a positive integer');
    const current = await store.loadMission({ root, missionId: id });
    const authorization = requiredFactPermission(current.mission, actor, action);
    const existingHistory = current.mission.transitionHistory ?? [];
    const history = existingHistory.length > 0 ? existingHistory : [legacyImportRecord(current.mission, current.revision, clock())];
    const timestamp = clock();
    const authoritativeFacts = validateFacts(mutate(current.mission, timestamp));
    const nextState = Object.freeze({ ...current.mission, authoritativeFacts, updatedAt: timestamp });
    const lineage = transitionRecord({
      stateVersion: expectedRevision + 1,
      previousVersion: expectedRevision,
      previousTransitionHash: history.at(-1).transitionHash,
      actor: authorization.actor,
      action,
      timestamp,
      input,
      before: current.mission,
      after: nextState,
      authorization,
      evidence,
    });
    const mission = Object.freeze({ ...nextState, transitionHistory: Object.freeze([...history, lineage]) });
    return store.saveMission({ root, mission, expectedRevision });
  }

  return Object.freeze({
    async create(input) { const id = requiredId(input?.id, 'mission id'); const state = authoritativeState(input); const created = Object.freeze({ ...createMission({ id, intent: state.objective, clock }), ...state }); const lineage = transitionRecord({ stateVersion: 1, previousVersion: 0, previousTransitionHash: null, actor: 'titan', action: 'create', timestamp: created.createdAt, input: state, before: Object.freeze({ id }), after: created, authorization: { actor: 'titan', actions: ['create_mission'], granted: true } }); const mission = Object.freeze({ ...created, transitionHistory: Object.freeze([lineage]) }); return store.saveMission({ root, mission }); },
    async transition({ missionId, expectedRevision, signal, update = {} }) { const id = requiredId(missionId, 'mission id'); if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new TypeError('revision conflict: expectedRevision must be a positive integer'); const current = await store.loadMission({ root, missionId: id }); const existingHistory = current.mission.transitionHistory ?? []; const history = existingHistory.length > 0 ? existingHistory : [legacyImportRecord(current.mission, current.revision, clock())]; const stateUpdate = validateUpdate(update, current.mission); const permittedActors = new Set((current.mission.permissions ?? []).map(({ actor }) => actor)); if (permittedActors.size > 0 && !permittedActors.has(signal?.agent)) throw new Error(`transition actor lacks mission permission: ${signal?.agent}`); const transitioned = transitionMission(current.mission, signal, { clock }); const nextState = Object.freeze({ ...transitioned, ...stateUpdate }); const permission = (current.mission.permissions ?? []).find(({ actor }) => actor === signal.agent); const lineage = transitionRecord({ stateVersion: expectedRevision + 1, previousVersion: expectedRevision, previousTransitionHash: history.at(-1).transitionHash, actor: signal.agent, action: signal.type, timestamp: nextState.updatedAt, input: { signal, update: stateUpdate }, before: current.mission, after: nextState, authorization: { actor: signal.agent, actions: permission?.actions ?? [], granted: permittedActors.size === 0 || Boolean(permission) }, evidence: signal.evidence }); const mission = Object.freeze({ ...nextState, transitionHistory: Object.freeze([...history, lineage]) }); return store.saveMission({ root, mission, expectedRevision }); },
    async recordFact({ missionId, expectedRevision, actor, fact, evidence }) {
      const normalized = recordableFact(fact);
      return commitFactOperation({
        missionId, expectedRevision, actor, action: 'record_fact', evidence,
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
    async supersedeFact({ missionId, expectedRevision, actor, factId, successor, reason, evidence }) {
      const next = successorInput(successor);
      const why = requiredText(reason, 'supersession reason');
      return commitFactOperation({
        missionId, expectedRevision, actor, action: 'supersede_fact', evidence,
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
    async correctFact({ missionId, expectedRevision, actor, factId, successor, reason, evidence }) {
      const next = successorInput(successor);
      const why = requiredText(reason, 'correction reason');
      return commitFactOperation({
        missionId, expectedRevision, actor, action: 'correct_fact', evidence,
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
    async revokeFact({ missionId, expectedRevision, actor, factId, reason, evidence }) {
      const why = requiredText(reason, 'revocation reason');
      return commitFactOperation({
        missionId, expectedRevision, actor, action: 'revoke_fact', evidence,
        input: { factId: requiredId(factId, 'fact id'), reason: why },
        mutate(mission, timestamp) {
          const predecessor = currentFactById(mission, factId);
          return (mission.authoritativeFacts ?? []).map((entry) => entry.id === predecessor.id
            ? { ...entry, status: 'revoked', revokedAt: timestamp, reason: why }
            : entry);
        },
      });
    },
    async get({ missionId }) { return store.loadMission({ root, missionId: requiredId(missionId, 'mission id') }); },
    async history({ missionId }) { const record = await store.loadMission({ root, missionId: requiredId(missionId, 'mission id') }); return Object.freeze(structuredClone(record.mission.transitionHistory ?? [])); },
    async verifyHistory({ missionId }) { const record = await store.loadMission({ root, missionId: requiredId(missionId, 'mission id') }); return verifyTransitionHistory(record.mission, record.revision); },
    async facts({ missionId, key, includeHistorical = false, includeTentative = false }) { const record = await store.loadMission({ root, missionId: requiredId(missionId, 'mission id') }); const factKey = key === undefined ? undefined : requiredText(key, 'fact key'); if (typeof includeHistorical !== 'boolean') throw new TypeError('includeHistorical must be a boolean'); if (typeof includeTentative !== 'boolean') throw new TypeError('includeTentative must be a boolean'); return currentFacts(record.mission.authoritativeFacts ?? [], { key: factKey, includeHistorical, includeTentative }); },
    async select({ missionId, fields }) { if (!Array.isArray(fields) || fields.length === 0) throw new TypeError('selected state fields must be a non-empty array'); const record = await store.loadMission({ root, missionId: requiredId(missionId, 'mission id') }); const selected = { missionId: record.mission.id, stateVersion: record.revision }; for (const field of fields) { if (!SELECTABLE_FIELDS.has(field)) throw new Error(`unsupported selected state field: ${field}`); selected[field] = field === 'currentFacts' ? currentFacts(record.mission.authoritativeFacts ?? []) : structuredClone(record.mission[field]); } return Object.freeze(selected); },
  });
}
