export const LIFECYCLE_PHASES = Object.freeze([
  'before_context',
  'after_context',
  'before_agent',
  'after_agent',
  'before_tool',
  'after_tool',
  'before_verification',
  'after_verification',
]);

const PHASE_SET = new Set(LIFECYCLE_PHASES);
const ADVISORY_KEYS = new Set(['note', 'tags', 'metrics', 'diagnostics']);
const FORBIDDEN_KEYS = new Set([
  'allowed_actions',
  'allowedActions',
  'state_version',
  'stateVersion',
  'agent_id',
  'agentId',
  'capability_id',
  'capabilityId',
  'evidence',
  'proof',
  'transition',
  'authorize',
  'authorization',
  'mission_state',
  'missionState',
  'store',
  'missionStore',
  'proofStore',
  'dangerousAuthority',
]);

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneData(value, label) {
  try {
    return structuredClone(value);
  } catch (error) {
    throw new TypeError(`${label} must be structured-cloneable data: ${error.message}`);
  }
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function assertNoAuthorityKeys(value, path = 'hook metadata') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoAuthorityKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!plainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`forbidden authority/control field in ${path}: ${key}`);
    }
    assertNoAuthorityKeys(child, `${path}.${key}`);
  }
}

function normalizeMetadata(value) {
  if (value === undefined || value === null) return null;
  if (!plainObject(value)) throw new TypeError('hook metadata must be an object');
  for (const key of Object.keys(value)) {
    if (!ADVISORY_KEYS.has(key)) {
      throw new Error(`forbidden authority/control or unknown hook metadata field: ${key}`);
    }
  }
  assertNoAuthorityKeys(value);
  const cloned = cloneData(value, 'hook metadata');
  if (cloned.note !== undefined && typeof cloned.note !== 'string') {
    throw new TypeError('hook metadata note must be a string');
  }
  if (cloned.tags !== undefined) {
    if (!Array.isArray(cloned.tags) || cloned.tags.some((tag) => typeof tag !== 'string')) {
      throw new TypeError('hook metadata tags must be an array of strings');
    }
  }
  if (cloned.metrics !== undefined && !plainObject(cloned.metrics)) {
    throw new TypeError('hook metadata metrics must be an object');
  }
  if (cloned.diagnostics !== undefined && !plainObject(cloned.diagnostics)) {
    throw new TypeError('hook metadata diagnostics must be an object');
  }
  return deepFreeze(cloned);
}

function normalizeHook(rawHook, index) {
  if (!plainObject(rawHook)) throw new TypeError(`hook ${index} must be an object`);
  if (!PHASE_SET.has(rawHook.phase)) throw new TypeError(`hook ${index} has invalid phase`);
  if (typeof rawHook.handler !== 'function') throw new TypeError(`hook ${index} handler must be a function`);
  if (rawHook.required !== undefined && typeof rawHook.required !== 'boolean') {
    throw new TypeError(`hook ${index} required must be boolean`);
  }
  if (rawHook.name !== undefined && (typeof rawHook.name !== 'string' || rawHook.name.trim().length === 0)) {
    throw new TypeError(`hook ${index} name must be a non-empty string`);
  }
  return Object.freeze({
    phase: rawHook.phase,
    handler: rawHook.handler,
    required: rawHook.required !== false,
    name: rawHook.name?.trim() || `hook-${index + 1}`,
  });
}

export function createLifecycleHooks({ hooks = [] } = {}) {
  if (!Array.isArray(hooks)) throw new TypeError('hooks must be an array');
  const registered = Object.freeze(hooks.map((hook, index) => normalizeHook(hook, index)));

  return Object.freeze({
    async run(phase, event = {}) {
      if (!PHASE_SET.has(phase)) throw new TypeError(`invalid lifecycle phase: ${phase}`);
      const frozenEvent = deepFreeze(cloneData(event, 'hook event'));
      const results = [];
      for (const hook of registered) {
        if (hook.phase !== phase) continue;
        try {
          const metadata = normalizeMetadata(await hook.handler(frozenEvent));
          if (metadata !== null) results.push(metadata);
        } catch (error) {
          if (hook.required) throw error;
        }
      }
      return Object.freeze(results);
    },
  });
}
