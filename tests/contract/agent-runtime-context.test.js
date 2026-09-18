import test from 'node:test';
import assert from 'node:assert/strict';

import { createAgentComposition } from '../../packages/agent/src/agent-composition.js';
import { createAgentRuntime } from '../../packages/agent/src/agent-runtime.js';
import { createModelAdapter } from '../../packages/agent/src/model-adapter.js';
import { parseAgentEnvelope } from '../../packages/contracts/src/agent-envelope.js';

function operationalNyxEnvelope() {
  return parseAgentEnvelope({
    mission_id: 'mission-runtime-context',
    task_id: 'task-runtime-context',
    operation_id: 'operation-runtime-context',
    agent_id: 'nyx',
    capability_id: 'repository-inspector',
    state_version: 7,
    objective: 'inspect the current repository state',
    allowed_actions: ['observe_repository'],
    required_inputs: [],
    evidence_requirements: ['resolved prepared context'],
    timeout: 5_000,
    resource_budget: { max_agent_calls: 1, max_tool_calls: 0 },
    expected_output_schema: { type: 'object', required: ['content'] },
    completion_conditions: ['provider returns non-empty content'],
    error_state: null,
    provenance: { requested_by: 'miss-vale-prime', created_at: '2026-09-16T00:00:00.000Z' },
  });
}

function boundContext() {
  return Object.freeze({
    handle: `ctx_${'a'.repeat(32)}`,
    integritySha256: 'b'.repeat(64),
    missionId: 'mission-runtime-context',
    stateVersion: 7,
    stateHash: 'c'.repeat(64),
    reader: 'nyx',
    context: Object.freeze({ entries: Object.freeze([]) }),
    stats: Object.freeze({ selectedCount: 0 }),
  });
}

test('operational invocation derives mission/reader, resolves context before provider, and returns exact identity', async () => {
  const calls = [];
  let providerRequest;
  const preparedContext = Object.freeze({
    async bind(request) {
      calls.push(['bind', request]);
      assert.equal(request.missionId, 'mission-runtime-context');
      assert.equal(request.reader, 'nyx');
      assert.deepEqual(request.query, { text: 'current objective' });
      assert.equal(request.limit, 4);
      assert.equal(request.maxEstimatedTokens, 512);
      return boundContext();
    },
    async revalidate(bound) {
      calls.push(['revalidate', bound]);
      return bound;
    },
  });
  const hooks = Object.freeze({
    async run(phase, event) {
      calls.push([phase, event]);
      return Object.freeze([]);
    },
  });
  const modelAdapter = createModelAdapter({
    provider: 'local',
    model: 'runtime-context-test',
    complete: async (request) => {
      calls.push(['provider', request]);
      providerRequest = request;
      return { content: 'context-bound response' };
    },
  });
  const composition = createAgentComposition({
    agentId: 'nyx',
    capabilityId: 'repository-inspector',
    modelAdapter,
    hooks,
    preparedContext,
  });
  const runtime = createAgentRuntime({ compositions: [composition] });
  const result = await runtime.respond({
    profile: 'owner',
    envelope: operationalNyxEnvelope(),
    contextRequest: {
      query: { text: 'current objective' },
      limit: 4,
      maxEstimatedTokens: 512,
    },
  });

  assert.equal(result.agentId, 'nyx');
  assert.equal(result.content, 'context-bound response');
  assert.deepEqual(result.context, {
    handle: `ctx_${'a'.repeat(32)}`,
    integritySha256: 'b'.repeat(64),
    stateVersion: 7,
    stateHash: 'c'.repeat(64),
    reader: 'nyx',
  });
  assert.equal(providerRequest.preparedContext.handle, result.context.handle);
  assert.deepEqual(calls.map(([name]) => name), [
    'before_context',
    'bind',
    'after_context',
    'before_agent',
    'revalidate',
    'provider',
    'after_agent',
  ]);
});

test('advisory invocation cannot request operational mission context', async () => {
  let providerCalls = 0;
  const runtime = createAgentRuntime({
    complete: async () => { providerCalls += 1; return { content: 'should not run' }; },
  });
  await assert.rejects(
    () => runtime.respond({
      profile: 'owner',
      agentId: 'agent-vale',
      text: 'hello',
      contextRequest: { query: { text: 'secret mission' } },
    }),
    /advisory.*context|context.*forbidden/i,
  );
  assert.equal(providerCalls, 0);
});

test('caller cannot override mission, reader, handle, or inject a resolved context', async () => {
  const modelAdapter = createModelAdapter({
    provider: 'local',
    model: 'runtime-context-override-test',
    complete: async () => ({ content: 'should not run' }),
  });
  const composition = createAgentComposition({
    agentId: 'nyx',
    capabilityId: 'repository-inspector',
    modelAdapter,
    preparedContext: Object.freeze({ bind: async () => boundContext(), revalidate: async (bound) => bound }),
  });
  const runtime = createAgentRuntime({ compositions: [composition] });
  for (const contextRequest of [
    { missionId: 'other-mission' },
    { reader: 'miss-vale-prime' },
    { handle: `ctx_${'f'.repeat(32)}` },
    { preparedContext: boundContext() },
  ]) {
    await assert.rejects(
      () => runtime.respond({ profile: 'owner', envelope: operationalNyxEnvelope(), contextRequest }),
      /context request.*field|forbidden/i,
    );
  }
});

test('failed context binding stops before the provider is invoked', async () => {
  let providerCalls = 0;
  const modelAdapter = createModelAdapter({
    provider: 'local',
    model: 'runtime-context-stale-test',
    complete: async () => { providerCalls += 1; return { content: 'should not run' }; },
  });
  const composition = createAgentComposition({
    agentId: 'nyx',
    capabilityId: 'repository-inspector',
    modelAdapter,
    preparedContext: Object.freeze({
      bind: async () => { throw new Error('prepared-context is stale for current mission state'); },
      revalidate: async (bound) => bound,
    }),
  });
  const runtime = createAgentRuntime({ compositions: [composition] });
  await assert.rejects(
    () => runtime.respond({ profile: 'owner', envelope: operationalNyxEnvelope(), contextRequest: {} }),
    /stale for current mission state/,
  );
  assert.equal(providerCalls, 0);
});
