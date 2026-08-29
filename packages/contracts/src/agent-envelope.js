const ENVELOPE_FIELDS = Object.freeze([
  'mission_id',
  'task_id',
  'agent_id',
  'capability_id',
  'state_version',
  'objective',
  'allowed_actions',
  'required_inputs',
  'evidence_requirements',
  'timeout',
  'resource_budget',
  'expected_output_schema',
  'completion_conditions',
  'error_state',
  'provenance',
]);
const FIELD_SET = new Set(ENVELOPE_FIELDS);

export class AgentEnvelopeError extends TypeError {
  constructor(code, message) {
    super(message);
    this.name = 'AgentEnvelopeError';
    this.code = code;
  }
}

function invalid(code, message) {
  throw new AgentEnvelopeError(code, message);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid('INVALID_OBJECT', `${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid('INVALID_OBJECT', `${label} must be a plain object`);
  }
  return value;
}

function text(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalid('INVALID_TEXT', `${label} must be a non-empty string`);
  }
  return value.trim();
}

function integer(value, label, { min = 0, positive = false } = {}) {
  if (!Number.isSafeInteger(value) || value < min || (positive && value === 0)) {
    invalid('INVALID_INTEGER', `${label} must be a ${positive ? 'positive' : 'non-negative'} safe integer`);
  }
  return value;
}

function textList(value, label, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    invalid('INVALID_LIST', `${label} must be ${nonEmpty ? 'a non-empty' : 'an'} array`);
  }
  const normalized = value.map((entry, index) => text(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    invalid('DUPLICATE_LIST_VALUE', `${label} cannot contain duplicate values`);
  }
  return Object.freeze(normalized);
}

function jsonValue(value, label, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('INVALID_JSON_VALUE', `${label} must contain only finite numbers`);
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) invalid('CIRCULAR_VALUE', `${label} cannot be circular`);
    seen.add(value);
    const out = Object.freeze(value.map((entry, index) => jsonValue(entry, `${label}[${index}]`, seen)));
    seen.delete(value);
    return out;
  }
  if (value && typeof value === 'object') {
    plainObject(value, label);
    if (seen.has(value)) invalid('CIRCULAR_VALUE', `${label} cannot be circular`);
    seen.add(value);
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        invalid('UNSAFE_KEY', `${label} contains an unsafe key`);
      }
      out[key] = jsonValue(entry, `${label}.${key}`, seen);
    }
    seen.delete(value);
    return Object.freeze(out);
  }
  invalid('INVALID_JSON_VALUE', `${label} must contain only JSON-compatible values`);
}

function resourceBudget(value) {
  const budget = plainObject(value, 'resource_budget');
  const keys = Object.keys(budget);
  if (keys.length === 0) invalid('EMPTY_RESOURCE_BUDGET', 'resource_budget must declare at least one limit');
  const out = {};
  for (const [key, amount] of Object.entries(budget)) {
    if (!/^[a-z][a-z0-9_]*$/.test(key)) invalid('INVALID_BUDGET_KEY', `resource_budget key is invalid: ${key}`);
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      invalid('INVALID_BUDGET_VALUE', `resource_budget.${key} must be a non-negative finite number`);
    }
    out[key] = amount;
  }
  return Object.freeze(out);
}

function provenance(value) {
  const record = plainObject(value, 'provenance');
  const requestedBy = text(record.requested_by, 'provenance.requested_by');
  const createdAt = text(record.created_at, 'provenance.created_at');
  if (Number.isNaN(Date.parse(createdAt))) invalid('INVALID_TIMESTAMP', 'provenance.created_at must be an ISO-compatible timestamp');
  return Object.freeze({ ...jsonValue(record, 'provenance'), requested_by: requestedBy, created_at: createdAt });
}

export function parseAgentEnvelope(input) {
  const envelope = plainObject(input, 'agent envelope');
  const keys = Object.keys(envelope);
  const unknown = keys.filter((key) => !FIELD_SET.has(key));
  const missing = ENVELOPE_FIELDS.filter((key) => !Object.hasOwn(envelope, key));
  if (unknown.length > 0) invalid('UNKNOWN_FIELD', `agent envelope contains unknown field(s): ${unknown.join(', ')}`);
  if (missing.length > 0) invalid('MISSING_FIELD', `agent envelope is missing field(s): ${missing.join(', ')}`);

  const errorState = envelope.error_state === null ? null : jsonValue(plainObject(envelope.error_state, 'error_state'), 'error_state');
  return Object.freeze({
    mission_id: text(envelope.mission_id, 'mission_id'),
    task_id: text(envelope.task_id, 'task_id'),
    agent_id: text(envelope.agent_id, 'agent_id'),
    capability_id: text(envelope.capability_id, 'capability_id'),
    state_version: integer(envelope.state_version, 'state_version'),
    objective: text(envelope.objective, 'objective'),
    allowed_actions: textList(envelope.allowed_actions, 'allowed_actions', { nonEmpty: true }),
    required_inputs: textList(envelope.required_inputs, 'required_inputs'),
    evidence_requirements: textList(envelope.evidence_requirements, 'evidence_requirements'),
    timeout: integer(envelope.timeout, 'timeout', { positive: true }),
    resource_budget: resourceBudget(envelope.resource_budget),
    expected_output_schema: jsonValue(plainObject(envelope.expected_output_schema, 'expected_output_schema'), 'expected_output_schema'),
    completion_conditions: textList(envelope.completion_conditions, 'completion_conditions', { nonEmpty: true }),
    error_state: errorState,
    provenance: provenance(envelope.provenance),
  });
}
