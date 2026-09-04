/**
 * Item 18 — model capability registry.
 * Model/provider metadata only. Mission control stays in Athere envelopes/MEA.
 */

export const MODEL_PROVIDERS = Object.freeze([
  'ollama',
  'openai',
  'gemini',
  'claude',
  'local',
  'none',
]);

const PROVIDER_SET = new Set(MODEL_PROVIDERS);

const REGISTRY = Object.freeze([
  Object.freeze({
    provider: 'ollama',
    model: 'llama3.2:3b',
    chat: true,
    tools: false,
    mission_control: false,
    transport: 'loopback',
  }),
  Object.freeze({
    provider: 'openai',
    model: 'gpt-compatible',
    chat: true,
    tools: false,
    mission_control: false,
    transport: 'remote',
  }),
  Object.freeze({
    provider: 'gemini',
    model: 'gemini-compatible',
    chat: true,
    tools: false,
    mission_control: false,
    transport: 'remote',
  }),
  Object.freeze({
    provider: 'claude',
    model: 'claude-compatible',
    chat: true,
    tools: false,
    mission_control: false,
    transport: 'remote',
  }),
  Object.freeze({
    provider: 'local',
    model: 'local-compatible',
    chat: true,
    tools: false,
    mission_control: false,
    transport: 'in-process',
  }),
  Object.freeze({
    provider: 'none',
    model: 'none',
    chat: false,
    tools: false,
    mission_control: false,
    transport: 'none',
  }),
]);

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function assertControlProtocolInvariant(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new TypeError('capability entry must be an object');
  }
  if (entry.mission_control === true) {
    throw new Error('model capabilities cannot include mission_control; Athere owns the control protocol');
  }
  if (entry.mission_control !== false) {
    throw new Error('mission_control must be explicitly false');
  }
  return true;
}

export function listModelCapabilities() {
  return Object.freeze(REGISTRY.map((entry) => {
    assertControlProtocolInvariant(entry);
    return entry;
  }));
}

export function getModelCapability(provider, model) {
  const providerId = requiredText(provider, 'provider');
  if (!PROVIDER_SET.has(providerId)) throw new Error(`unknown model provider: ${providerId}`);
  const modelId = requiredText(model, 'model');
  const exact = REGISTRY.find((entry) => entry.provider === providerId && entry.model === modelId);
  if (exact) {
    assertControlProtocolInvariant(exact);
    return exact;
  }
  const byProvider = REGISTRY.find((entry) => entry.provider === providerId);
  if (!byProvider) throw new Error(`unknown model provider: ${providerId}`);
  const resolved = Object.freeze({
    ...byProvider,
    model: modelId,
  });
  assertControlProtocolInvariant(resolved);
  return resolved;
}
