/**
 * Item 19 — MCP adapter (tool/resource connectivity).
 * Does not own mission authority, memory, verification, or executive control.
 */

import {
  getTransportCapability,
  normalizeMcpResourceResult,
  normalizeMcpToolDescriptor,
  normalizeMcpToolResult,
} from '../../contracts/src/protocol-interop.js';

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function createMcpAdapter({
  transport = 'in-process',
  allowRemote = false,
  callTool,
  readResource,
  listTools,
} = {}) {
  const transportMode = requiredText(transport, 'transport');
  if (transportMode === 'remote' && allowRemote !== true) {
    throw new Error('remote mcp transport requires allowRemote: true');
  }

  const capabilities = getTransportCapability('mcp');
  if (capabilities.mission_control !== false) {
    throw new Error('mcp adapter cannot enable mission_control');
  }

  const adapter = {
    protocol: 'mcp',
    transport: transportMode,
    capabilities,
  };

  if (typeof callTool === 'function') {
    adapter.callTool = async (request) => {
      const name = requiredText(request?.name, 'tool name');
      return normalizeMcpToolResult(await callTool({
        name,
        arguments: request?.arguments ?? {},
      }));
    };
  }

  if (typeof readResource === 'function') {
    adapter.readResource = async (request) => {
      const uri = requiredText(request?.uri, 'resource uri');
      return normalizeMcpResourceResult(await readResource({ uri }));
    };
  }

  if (typeof listTools === 'function') {
    adapter.listTools = async () => {
      const tools = await listTools();
      if (!Array.isArray(tools)) throw new TypeError('listTools must return an array');
      return Object.freeze(tools.map((tool) => normalizeMcpToolDescriptor(tool)));
    };
  }

  return Object.freeze(adapter);
}
