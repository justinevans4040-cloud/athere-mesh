/**
 * Item 19 — protocol bridge.
 * Surfaces MCP/A2A as advisory connectivity. Never mission control.
 */

import { ATHERE_OWNED_CAPABILITIES } from '../../contracts/src/protocol-interop.js';

function advisoryObservation({ protocol, kind, result }) {
  return Object.freeze({
    protocol,
    kind,
    advisory: true,
    result,
  });
}

export function createProtocolBridge({ mcp, a2a } = {}) {
  const owns = Object.freeze(Object.fromEntries(
    ATHERE_OWNED_CAPABILITIES.map((capability) => [capability, false]),
  ));

  const bridge = {
    owns,
  };

  if (mcp) {
    if (mcp.protocol !== 'mcp') throw new TypeError('mcp adapter required');
    if (mcp.capabilities?.mission_control !== false) {
      throw new Error('mcp bridge adapter cannot enable mission_control');
    }
    if (typeof mcp.callTool === 'function') {
      bridge.invokeMcpTool = async (request) => advisoryObservation({
        protocol: 'mcp',
        kind: 'tool',
        result: await mcp.callTool(request),
      });
    }
    if (typeof mcp.readResource === 'function') {
      bridge.readMcpResource = async (request) => advisoryObservation({
        protocol: 'mcp',
        kind: 'resource',
        result: await mcp.readResource(request),
      });
    }
  }

  if (a2a) {
    if (a2a.protocol !== 'a2a') throw new TypeError('a2a adapter required');
    if (a2a.capabilities?.mission_control !== false) {
      throw new Error('a2a bridge adapter cannot enable mission_control');
    }
    if (typeof a2a.send === 'function') {
      bridge.sendA2a = async (message) => advisoryObservation({
        protocol: 'a2a',
        kind: 'send',
        result: await a2a.send(message),
      });
    }
    if (typeof a2a.receive === 'function') {
      bridge.receiveA2a = async () => advisoryObservation({
        protocol: 'a2a',
        kind: 'receive',
        result: await a2a.receive(),
      });
    }
  }

  return Object.freeze(bridge);
}
