import { createMission, transitionMission } from '../../contracts/src/mission.js';
import { loadMission, saveMission } from './mission-store.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MUTABLE_FIELDS = new Set([
  'goals', 'subgoals', 'dependencies', 'completedWork', 'pendingWork', 'failedWork', 'evidence',
  'constraints', 'activeAgents', 'artifactReferences', 'currentPlan', 'environmentObservations',
]);
const SELECTABLE_FIELDS = new Set(['objective', 'permissions', ...MUTABLE_FIELDS]);

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
}

function requiredId(value, label) {
  const id = requiredText(value, label);
  if (!SAFE_ID.test(id)) throw new TypeError(`${label} is invalid`);
  return id;
}

function stringArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return Object.freeze(value.map((item) => requiredText(item, `${label} entry`)));
}

function uniqueIds(items, label) {
  const ids = new Set();
  for (const item of items) {
    const id = requiredId(item?.id, `${label} id`);
    if (ids.has(id)) throw new Error(`duplicate ${label} id: ${id}`);
    ids.add(id);
  }
  return ids;
}

function records(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return Object.freeze(value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new TypeError(`${label} entry must be an object`);
    return Object.freeze(structuredClone(item));
  }));
}

function validateGoals(value) {
  const items = records(value, 'goals');
  uniqueIds(items, 'goal');
  for (const item of items) requiredText(item.objective, 'goal objective');
  return items;
}

function validateSubgoals(value, goalIds) {
  const items = records(value, 'subgoals');
  const ids = uniqueIds(items, 'subgoal');
  for (const item of items) {
    requiredText(item.objective, 'subgoal objective');
    if (!goalIds.has(requiredId(item.goalId, 'subgoal goalId'))) throw new Error(`subgoal references unknown goal: ${item.goalId}`);
  }
  return { items, ids };
}

function validateDependencies(value, subgoalIds) {
  const items = records(value, 'dependencies');
  for (const item of items) {
    const prerequisite = requiredId(item.prerequisite, 'dependency prerequisite');
    const dependent = requiredId(item.dependent, 'dependency dependent');
    if (!subgoalIds.has(prerequisite) || !subgoalIds.has(dependent)) throw new Error('dependency references unknown subgoal');
    if (prerequisite === dependent) throw new Error('subgoal cannot depend on itself');
  }
  return items;
}

function validatePermissions(value) {
  const items = records(value, 'permissions');
  for (const item of items) {
    requiredId(item.actor, 'permission actor');
    stringArray(item.actions, 'permission actions');
  }
  return items;
}

function validatePlan(value, subgoalIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('currentPlan must be an object');
  const plan = Object.freeze(structuredClone(value));
  requiredId(plan.id, 'plan id');
  if (!Number.isSafeInteger(plan.version) || plan.version < 1) throw new TypeError('plan version must be a positive integer');
  const steps = stringArray(plan.steps, 'plan steps');
  for (const step of steps) if (!subgoalIds.has(step)) throw new Error(`plan references unknown subgoal: ${step}`);
  return Object.freeze({ ...plan, steps });
}

function validateObservations(value) {
  const items = records(value, 'environmentObservations');
  for (const item of items) {
    requiredText(item.source, 'observation source');
    requiredText(item.key, 'observation key');
    if (!Object.hasOwn(item, 'value')) throw new TypeError('observation value is required');
    const observedAt = requiredText(item.observedAt, 'observation observedAt');
    if (Number.isNaN(Date.parse(observedAt))) throw new TypeError('observation observedAt must be an ISO timestamp');
  }
  return items;
}

function authoritativeState(input) {
  const goals = validateGoals(input.goals);
  const { items: subgoals, ids: subgoalIds } = validateSubgoals(input.subgoals, new Set(goals.map(({ id }) => id)));
  const currentPlan = validatePlan(input.currentPlan, subgoalIds);
  return Object.freeze({
    objective: requiredText(input.objective, 'objective'),
    goals,
    subgoals,
    dependencies: validateDependencies(input.dependencies, subgoalIds),
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
  });
}

function validateUpdate(update, mission) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) throw new TypeError('state update must be an object');
  for (const field of Object.keys(update)) {
    if (!MUTABLE_FIELDS.has(field)) throw new Error(`unsupported authoritative state field: ${field}`);
  }
  const validated = {};
  for (const field of ['completedWork', 'pendingWork', 'failedWork', 'constraints', 'activeAgents']) {
    if (Object.hasOwn(update, field)) validated[field] = stringArray(update[field], field);
  }
  for (const field of ['evidence', 'artifactReferences', 'environmentObservations']) {
    if (Object.hasOwn(update, field)) validated[field] = field === 'environmentObservations'
      ? validateObservations(update[field])
      : records(update[field], field);
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
  return Object.freeze(validated);
}

export function createMissionStateService({ root, clock = () => new Date().toISOString(), store = { loadMission, saveMission } } = {}) {
  requiredText(root, 'root');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  if (typeof store?.loadMission !== 'function' || typeof store?.saveMission !== 'function') throw new TypeError('store must provide loadMission and saveMission');

  return Object.freeze({
    async create(input) {
      const id = requiredId(input?.id, 'mission id');
      const state = authoritativeState(input);
      const mission = Object.freeze({ ...createMission({ id, intent: state.objective, clock }), ...state });
      return store.saveMission({ root, mission });
    },

    async transition({ missionId, expectedRevision, signal, update = {} }) {
      const id = requiredId(missionId, 'mission id');
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new TypeError('revision conflict: expectedRevision must be a positive integer');
      const current = await store.loadMission({ root, missionId: id });
      const stateUpdate = validateUpdate(update, current.mission);
      const permittedActors = new Set((current.mission.permissions ?? []).map(({ actor }) => actor));
      if (permittedActors.size > 0 && !permittedActors.has(signal?.agent)) {
        throw new Error(`transition actor lacks mission permission: ${signal?.agent}`);
      }
      const transitioned = transitionMission(current.mission, signal, { clock });
      const mission = Object.freeze({ ...transitioned, ...stateUpdate });
      return store.saveMission({ root, mission, expectedRevision });
    },

    async get({ missionId }) {
      return store.loadMission({ root, missionId: requiredId(missionId, 'mission id') });
    },

    async select({ missionId, fields }) {
      if (!Array.isArray(fields) || fields.length === 0) throw new TypeError('selected state fields must be a non-empty array');
      const record = await store.loadMission({ root, missionId: requiredId(missionId, 'mission id') });
      const selected = { missionId: record.mission.id, stateVersion: record.revision };
      for (const field of fields) {
        if (!SELECTABLE_FIELDS.has(field)) throw new Error(`unsupported selected state field: ${field}`);
        selected[field] = structuredClone(record.mission[field]);
      }
      return Object.freeze(selected);
    },
  });
}
