import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ATHERE_OWNED_CAPABILITIES,
  TRANSPORT_PROTOCOLS,
  assertAthereOwns,
  assertTransportCannotOwn,
  listTransportCapabilities,
  normalizeMcpToolResult,
  normalizeA2aMessage,
} from '../../packages/contracts/src/protocol-interop.js';
import { createMcpAdapter } from '../../packages/interop/src/mcp-adapter.js';
import { createA2aAdapter } from '../../packages/interop/src/a2a-adapter.js';
import { createProtocolBridge } from '../../packages/interop/src/protocol-bridge.js';

test('Item 19 contract: Athere owns moat capabilities; MCP/A2A are transports only', () => {
  for (const capability of [
    'mission_authority',
    'memory',
    'verification',
    'policy',
    'state',
    'learning',
    'executive_control',
  ]) {
    assert.ok(ATHERE_OWNED_CAPABILITIES.includes(capability), capability);
    assert.equal(assertAthereOwns(capability), true);
  }
  assert.deepEqual([...TRANSPORT_PROTOCOLS].sort(), ['a2a', 'mcp']);
  for (const protocol of TRANSPORT_PROTOCOLS) {
    assert.throws(() => assertTransportCannotOwn(protocol, 'mission_authority'), /cannot own/);
    assert.throws(() => assertTransportCannotOwn(protocol, 'executive_control'), /cannot own/);
  }
  const caps = listTransportCapabilities();
  assert.ok(caps.length >= 2);
  for (const entry of caps) {
    assert.equal(entry.mission_control, false);
    assert.equal(entry.owns_mission_authority, false);
    assert.ok(TRANSPORT_PROTOCOLS.includes(entry.protocol));
  }
});

test('Item 19 contract: MCP/A2A results cannot carry mission control fields', () => {
  assert.deepEqual(
    normalizeMcpToolResult({ content: [{ type: 'text', text: 'ok' }] }),
    { content: [{ type: 'text', text: 'ok' }] },
  );
  assert.throws(
    () => normalizeMcpToolResult({ content: [], completedWork: ['verify-proof'] }),
    /control field/,
  );
  assert.throws(
    () => normalizeMcpToolResult({ content: [], status: 'completed' }),
    /control field/,
  );
  assert.deepEqual(
    normalizeA2aMessage({
      role: 'agent',
      parts: [{ type: 'text', text: 'hello' }],
    }),
    { role: 'agent', parts: [{ type: 'text', text: 'hello' }] },
  );
  assert.throws(
    () => normalizeA2aMessage({ role: 'agent', parts: [], transition: { status: 'completed' } }),
    /control field/,
  );
});

test('Item 19 contract: adapters expose connectivity without owning Athere control protocol', async () => {
  const mcp = createMcpAdapter({
    callTool: async ({ name }) => ({ content: [{ type: 'text', text: `tool:${name}` }] }),
    readResource: async ({ uri }) => ({ contents: [{ uri, text: 'resource-body' }] }),
  });
  const a2a = createA2aAdapter({
    send: async (message) => ({ accepted: true, echo: message.parts[0].text }),
    receive: async () => ({ role: 'agent', parts: [{ type: 'text', text: 'peer' }] }),
  });

  assert.equal(mcp.protocol, 'mcp');
  assert.equal(a2a.protocol, 'a2a');
  assert.equal(mcp.capabilities.mission_control, false);
  assert.equal(a2a.capabilities.mission_control, false);

  const tool = await mcp.callTool({ name: 'list_files', arguments: {} });
  assert.equal(tool.content[0].text, 'tool:list_files');
  const resource = await mcp.readResource({ uri: 'file:///tmp/x' });
  assert.equal(resource.contents[0].text, 'resource-body');

  const sent = await a2a.send({ role: 'user', parts: [{ type: 'text', text: 'ping' }] });
  assert.equal(sent.accepted, true);
  const received = await a2a.receive();
  assert.equal(received.parts[0].text, 'peer');

  const bridge = createProtocolBridge({ mcp, a2a });
  assert.equal(bridge.owns.mission_authority, false);
  assert.equal(bridge.owns.memory, false);
  assert.equal(bridge.owns.verification, false);
  assert.equal(bridge.owns.policy, false);
  assert.equal(bridge.owns.state, false);
  assert.equal(bridge.owns.learning, false);
  assert.equal(bridge.owns.executive_control, false);
  assert.equal(typeof bridge.transition, 'undefined');
  assert.equal(typeof bridge.certify, 'undefined');
  assert.equal(typeof bridge.recordFact, 'undefined');
  assert.equal(typeof bridge.decideNext, 'undefined');

  const observation = await bridge.invokeMcpTool({ name: 'list_files', arguments: {} });
  assert.equal(observation.protocol, 'mcp');
  assert.equal(observation.kind, 'tool');
  assert.equal(observation.advisory, true);
  assert.equal(observation.result.content[0].text, 'tool:list_files');
});
