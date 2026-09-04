/**
 * Item 19 — A2A adapter (external agent communication).
 * Does not own mission authority, memory, verification, or executive control.
 */

import {
  getTransportCapability,
  normalizeA2aMessage,
  normalizeA2aSendResult,
} from '../../contracts/src/protocol-interop.js';

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function createA2aAdapter({
  transport = 'in-process',
  allowRemote = false,
  send,
  receive,
} = {}) {
  const transportMode = requiredText(transport, 'transport');
  if (transportMode === 'remote' && allowRemote !== true) {
    throw new Error('remote a2a transport requires allowRemote: true');
  }

  const capabilities = getTransportCapability('a2a');
  if (capabilities.mission_control !== false) {
    throw new Error('a2a adapter cannot enable mission_control');
  }

  const adapter = {
    protocol: 'a2a',
    transport: transportMode,
    capabilities,
  };

  if (typeof send === 'function') {
    adapter.send = async (message) => {
      const normalized = normalizeA2aMessage(message);
      return normalizeA2aSendResult(await send(normalized));
    };
  }

  if (typeof receive === 'function') {
    adapter.receive = async () => normalizeA2aMessage(await receive());
  }

  return Object.freeze(adapter);
}
