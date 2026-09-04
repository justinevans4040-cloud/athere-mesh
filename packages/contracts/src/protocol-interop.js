/**
 * Item 19 — MCP/A2A protocol interop boundary.
 * Transports connect tools/resources/agents. Athere keeps the moat.
 */

export const ATHERE_OWNED_CAPABILITIES = Object.freeze([
  'mission_authority',
  'memory',
  'verification',
  'policy',
  'state',
  'learning',
  'executive_control',
]);

export const TRANSPORT_PROTOCOLS = Object.freeze(['mcp', 'a2a']);

const OWNED_SET = new Set(ATHERE_OWNED_CAPABILITIES);
const PROTOCOL_SET = new Set(TRANSPORT_PROTOCOLS);

const FORBIDDEN_CONTROL_FIELDS = Object.freeze([
  'completedWork',
  'pendingWork',
  'failedWork',
  'status',
  'transition',
  'revision',
  'stateHash',
  'epistemicClaims',
  'authoritativeFacts',
  'permissions',
  'mission_control',
  'certify',
  'recordFact',
  'decideNext',
]);

const FORBIDDEN_SET = new Set(FORBIDDEN_CONTROL_FIELDS);

const REGISTRY = Object.freeze([
  Object.freeze({
    protocol: 'mcp',
    purpose: 'tool_resource_connectivity',
    mission_control: false,
    owns_mission_authority: false,
    owns_memory: false,
    owns_verification: false,
    owns_policy: false,
    owns_state: false,
    owns_learning: false,
    owns_executive_control: false,
  }),
  Object.freeze({
    protocol: 'a2a',
    purpose: 'external_agent_communication',
    mission_control: false,
    owns_mission_authority: false,
    owns_memory: false,
    owns_verification: false,
    owns_policy: false,
    owns_state: false,
    owns_learning: false,
    owns_executive_control: false,
  }),
]);

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

export function assertAthereOwns(capability) {
  const id = requiredText(capability, 'capability');
  if (!OWNED_SET.has(id)) {
    throw new Error(`unknown Athere-owned capability: ${id}`);
  }
  return true;
}

export function assertTransportCannotOwn(protocol, capability) {
  const protocolId = requiredText(protocol, 'protocol');
  if (!PROTOCOL_SET.has(protocolId)) {
    throw new Error(`unknown transport protocol: ${protocolId}`);
  }
  const capabilityId = requiredText(capability, 'capability');
  if (OWNED_SET.has(capabilityId)) {
    throw new Error(`transport ${protocolId} cannot own ${capabilityId}; Athere owns the moat`);
  }
  return true;
}

export function assertNoControlFields(value, label = 'transport result') {
  const object = plainObject(value, label);
  for (const key of Object.keys(object)) {
    if (FORBIDDEN_SET.has(key)) {
      throw new Error(`${label} cannot include control field: ${key}`);
    }
  }
  return object;
}

function assertNoNestedControlFields(value, label) {
  assertNoControlFields(value, label);
  for (const [key, child] of Object.entries(value)) {
    if (Array.isArray(child)) {
      for (const [index, entry] of child.entries()) {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
          assertNoControlFields(entry, `${label}.${key}[${index}]`);
        }
      }
    } else if (child && typeof child === 'object') {
      assertNoControlFields(child, `${label}.${key}`);
    }
  }
  return value;
}

export function listTransportCapabilities() {
  return Object.freeze(REGISTRY.map((entry) => Object.freeze({ ...entry })));
}

export function getTransportCapability(protocol) {
  const protocolId = requiredText(protocol, 'protocol');
  const entry = REGISTRY.find((item) => item.protocol === protocolId);
  if (!entry) throw new Error(`unknown transport protocol: ${protocolId}`);
  return entry;
}

export function normalizeMcpToolResult(result) {
  const object = assertNoNestedControlFields(result, 'mcp tool result');
  if (!Array.isArray(object.content)) {
    throw new TypeError('mcp tool result content must be an array');
  }
  return Object.freeze({
    content: Object.freeze(object.content.map((part) => Object.freeze({ ...part }))),
  });
}

export function normalizeMcpResourceResult(result) {
  const object = assertNoNestedControlFields(result, 'mcp resource result');
  if (!Array.isArray(object.contents)) {
    throw new TypeError('mcp resource result contents must be an array');
  }
  return Object.freeze({
    contents: Object.freeze(object.contents.map((part) => Object.freeze({ ...part }))),
  });
}

export function normalizeA2aMessage(message) {
  const object = assertNoNestedControlFields(message, 'a2a message');
  const role = requiredText(object.role, 'a2a role');
  if (!Array.isArray(object.parts)) {
    throw new TypeError('a2a message parts must be an array');
  }
  return Object.freeze({
    role,
    parts: Object.freeze(object.parts.map((part) => Object.freeze({ ...part }))),
  });
}

export function normalizeA2aSendResult(result) {
  const object = assertNoNestedControlFields(result, 'a2a send result');
  if (object.accepted !== true) {
    throw new Error('a2a send result must set accepted: true');
  }
  const cleaned = { accepted: true };
  for (const [key, value] of Object.entries(object)) {
    if (key === 'accepted') continue;
    cleaned[key] = value;
  }
  return Object.freeze(cleaned);
}

export function normalizeMcpToolDescriptor(tool) {
  const object = assertNoControlFields(tool, 'mcp tool descriptor');
  const name = requiredText(object.name, 'tool name');
  return Object.freeze({ ...object, name });
}
