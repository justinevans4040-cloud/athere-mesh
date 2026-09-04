/**
 * Item 18 — universal model/agent adapter.
 * Swappable providers behind one complete({ agent, text }) contract.
 * Does not own mission control, MEA, or state mutation.
 */

import {
  assertControlProtocolInvariant,
  getModelCapability,
} from '../../contracts/src/model-capability-registry.js';
import { createOllamaCompletion } from './ollama-client.js';

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeCompletionResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError('model adapter must return an object');
  }
  const keys = Object.keys(result);
  for (const key of keys) {
    if (key !== 'content') {
      throw new Error(`model adapter result cannot include control field: ${key}`);
    }
  }
  if (typeof result.content !== 'string') throw new TypeError('model adapter content must be a string');
  return Object.freeze({ content: result.content });
}

function wrapComplete(complete) {
  if (typeof complete !== 'function') throw new TypeError('complete function is required');
  return async (request) => normalizeCompletionResult(await complete(request));
}

export function createModelAdapter({
  provider,
  model,
  allowRemote = false,
  complete,
  baseUrl,
  timeoutMs,
  fetchImpl,
} = {}) {
  const providerId = requiredText(provider, 'provider');
  const modelId = requiredText(model, 'model');
  const capabilities = getModelCapability(providerId, modelId);
  assertControlProtocolInvariant(capabilities);

  if (capabilities.transport === 'remote' && allowRemote !== true) {
    throw new Error(`remote model provider ${providerId} requires allowRemote: true`);
  }

  let completeFn;
  if (providerId === 'ollama') {
    completeFn = createOllamaCompletion({
      model: modelId,
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(fetchImpl === undefined ? {} : { fetchImpl }),
    });
  } else if (typeof complete === 'function') {
    completeFn = complete;
  } else {
    throw new Error(`model provider ${providerId} is not configured (inject complete or use ollama)`);
  }

  const adapterComplete = wrapComplete(completeFn);
  return Object.freeze({
    provider: providerId,
    model: modelId,
    capabilities,
    complete: adapterComplete,
  });
}

export function createCompletionFromAdapter(adapter) {
  if (!adapter || typeof adapter.complete !== 'function') {
    throw new TypeError('model adapter with complete() is required');
  }
  if (!adapter.capabilities || typeof adapter.capabilities !== 'object' || Array.isArray(adapter.capabilities)) {
    throw new Error('model adapter capabilities are required');
  }
  assertControlProtocolInvariant(adapter.capabilities);
  // Always re-wrap so bypass adapters cannot leak control fields.
  return wrapComplete(adapter.complete);
}
