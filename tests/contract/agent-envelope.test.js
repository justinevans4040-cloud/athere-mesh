import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentEnvelopeError, parseAgentEnvelope } from '../../packages/contracts/src/agent-envelope.js';
import { createAgentRuntime } from '../../packages/agent/src/agent-runtime.js';

function envelope(overrides = {}) {
  return {
    mission_id: ' mission-1 ', task_id: 'task-1', agent_id: 'agent-vale', capability_id: 'ollama-chat',
    state_version: 3, objective: ' Give me a live response. ', allowed_actions: ['respond'],
    required_inputs: [], evidence_requirements: ['non-empty response'], timeout: 30000,
    resource_budget: { max_agent_calls: 1, max_tool_calls: 0 },
    expected_output_schema: { type: 'object', required: ['content'] },
    completion_conditions: ['non-empty model response'], error_state: null,
    provenance: { requested_by: 'titan', created_at: '2026-08-29T14:15:00.000Z' },
    ...overrides,
  };
}

test('parseAgentEnvelope returns an immutable normalized protocol record', () => {
  const parsed = parseAgentEnvelope(envelope());
  assert.equal(parsed.mission_id, 'mission-1');
  assert.equal(parsed.objective, 'Give me a live response.');
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.allowed_actions), true);
  assert.equal(Object.isFrozen(parsed.expected_output_schema), true);
});

test('parseAgentEnvelope rejects unknown protocol fields', () => {
  assert.throws(() => parseAgentEnvelope(envelope({ surprise: true })), (error) => {
    assert.equal(error instanceof AgentEnvelopeError, true);
    assert.equal(error.code, 'UNKNOWN_FIELD');
    return true;
  });
});

test('parseAgentEnvelope rejects malformed state versions and duplicate actions', () => {
  assert.throws(() => parseAgentEnvelope(envelope({ state_version: '3' })), /state_version/);
  assert.throws(() => parseAgentEnvelope(envelope({ allowed_actions: ['respond', 'respond'] })), /duplicate/i);
});

test('parseAgentEnvelope rejects non-JSON output schemas', () => {
  assert.throws(() => parseAgentEnvelope(envelope({ expected_output_schema: { validate() {} } })), /JSON-compatible/);
});

test('agent runtime executes a valid universal envelope and passes the normalized envelope to the provider', async () => {
  let received;
  const runtime = createAgentRuntime({ complete: async (request) => { received = request; return { content: 'done' }; } });
  assert.deepEqual(await runtime.respond({ profile: 'owner', envelope: envelope() }), { agentId: 'agent-vale', content: 'done', live: true });
  assert.equal(received.text, 'Give me a live response.');
  assert.equal(received.envelope.task_id, 'task-1');
  assert.equal(Object.isFrozen(received.envelope), true);
});

test('malformed or incompatible envelopes are rejected before provider execution', async () => {
  let calls = 0;
  const runtime = createAgentRuntime({ complete: async () => { calls += 1; return { content: 'should not run' }; } });
  await assert.rejects(() => runtime.respond({ profile: 'owner', envelope: envelope({ state_version: '3' }) }), /state_version/);
  await assert.rejects(() => runtime.respond({ profile: 'owner', envelope: envelope({ capability_id: 'repository-inspector' }) }), /not bound to capability/);
  await assert.rejects(() => runtime.respond({ profile: 'owner', envelope: envelope({ allowed_actions: ['inspect'] }) }), /does not permit respond/);
  assert.equal(calls, 0);
});

test('legacy advisory chat is wrapped into the universal envelope before provider execution', async () => {
  let received;
  const runtime = createAgentRuntime({ complete: async (request) => { received = request; return { content: 'advisory only' }; } });
  await runtime.respond({ profile: 'owner', agentId: 'agent-vale', text: 'hello' });
  assert.equal(received.envelope.agent_id, 'agent-vale');
  assert.equal(received.envelope.capability_id, 'ollama-chat');
  assert.equal(received.envelope.objective, 'hello');
  assert.deepEqual(received.envelope.allowed_actions, ['respond']);
});
