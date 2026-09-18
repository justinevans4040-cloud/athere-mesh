import { assertControlProtocolInvariant } from '../../contracts/src/model-capability-registry.js';
import { fleetRegistry } from '../../fleet/src/registry.js';
import { isBrandedProgressiveSkillDisclosure } from '../../skills/src/progressive-skill-disclosure.js';
import { isCanonicalModelAdapter } from './model-adapter.js';

const CANONICAL_AGENT_COMPOSITIONS = new WeakSet();

export function isCanonicalAgentComposition(value) {
  return value != null && typeof value === 'object' && CANONICAL_AGENT_COMPOSITIONS.has(value);
}

const agentById = new Map(fleetRegistry.agents.map((agent) => [agent.id, agent]));

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function validateModelAdapter(modelAdapter) {
  if (!modelAdapter || typeof modelAdapter !== 'object' || Array.isArray(modelAdapter)) {
    throw new TypeError('modelAdapter must be an object');
  }
  if (typeof modelAdapter.complete !== 'function') {
    throw new TypeError('modelAdapter complete() is required');
  }
  if (!modelAdapter.capabilities || typeof modelAdapter.capabilities !== 'object' || Array.isArray(modelAdapter.capabilities)) {
    throw new TypeError('modelAdapter capabilities are required');
  }
  assertControlProtocolInvariant(modelAdapter.capabilities);
  if (!isCanonicalModelAdapter(modelAdapter)) {
    throw new TypeError('canonical model adapter from createModelAdapter is required');
  }
}

function validateToolAdapters(toolAdapters) {
  if (!Array.isArray(toolAdapters)) throw new TypeError('toolAdapters must be an array');
  for (const [index, adapter] of toolAdapters.entries()) {
    if (!adapter || typeof adapter !== 'object' || Array.isArray(adapter)) {
      throw new TypeError(`tool adapter ${index} must be an object`);
    }
    if (!adapter.capabilities || typeof adapter.capabilities !== 'object' || Array.isArray(adapter.capabilities)) {
      throw new TypeError(`tool adapter ${index} capabilities are required`);
    }
    if (adapter.capabilities.mission_control !== false) {
      throw new Error(`tool adapter ${index} capabilities.mission_control must be explicitly false`);
    }
  }
  return Object.freeze([...toolAdapters]);
}

function optionalInterface(value, label, methods) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  for (const method of methods) {
    if (typeof value[method] !== 'function') {
      throw new TypeError(`${label} must provide ${method}()`);
    }
  }
  return value;
}

export function createAgentComposition({
  agentId,
  capabilityId,
  modelAdapter,
  toolAdapters = [],
  skills,
  hooks,
  preparedContext,
} = {}) {
  const requestedAgentId = requiredText(agentId, 'agentId');
  const agent = agentById.get(requestedAgentId);
  if (!agent) throw new Error(`unknown agent: ${requestedAgentId}`);
  if (agent.enabled !== true) throw new Error(`agent is not operational: ${requestedAgentId}`);

  const requestedCapability = requiredText(capabilityId, 'capabilityId');
  if (agent.executorId !== requestedCapability) {
    throw new Error(`capability mismatch for ${requestedAgentId}: expected ${agent.executorId}, received ${requestedCapability}`);
  }

  validateModelAdapter(modelAdapter);
  const validatedTools = validateToolAdapters(toolAdapters);
  let validatedSkills;
  if (skills !== undefined && skills !== null) {
    if (!isBrandedProgressiveSkillDisclosure(skills)) {
      throw new TypeError('skills must be a branded progressive skill disclosure');
    }
    validatedSkills = optionalInterface(skills, 'skills', ['list', 'load']);
  }
  const validatedHooks = optionalInterface(hooks, 'hooks', ['run']);
  const validatedPreparedContext = optionalInterface(preparedContext, 'preparedContext', ['bind', 'revalidate']);

  const composition = Object.freeze({
    agent,
    capabilityId: requestedCapability,
    modelAdapter,
    toolAdapters: validatedTools,
    ...(validatedSkills === undefined ? {} : { skills: validatedSkills }),
    ...(validatedHooks === undefined ? {} : { hooks: validatedHooks }),
    ...(validatedPreparedContext === undefined ? {} : { preparedContext: validatedPreparedContext }),
  });
  CANONICAL_AGENT_COMPOSITIONS.add(composition);
  return composition;
}
