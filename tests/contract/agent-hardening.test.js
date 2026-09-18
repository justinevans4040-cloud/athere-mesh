import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

import { createAgentComposition } from '../../packages/agent/src/agent-composition.js';
import { createAgentRuntime } from '../../packages/agent/src/agent-runtime.js';
import { createModelAdapter } from '../../packages/agent/src/model-adapter.js';
import { createOllamaCompletion } from '../../packages/agent/src/ollama-client.js';
import { parseAgentEnvelope } from '../../packages/contracts/src/agent-envelope.js';
import { fleetRegistry } from '../../packages/fleet/src/registry.js';

function safeModelAdapter() {
  return createModelAdapter({
    provider: 'local',
    model: 'hardening-test',
    complete: async () => ({ content: 'ok' }),
  });
}

function operationalEnvelope({ timeout = 5_000 } = {}) {
  return parseAgentEnvelope({
    mission_id: 'mission-hardening',
    task_id: 'task-hardening',
    operation_id: 'operation-hardening',
    agent_id: 'nyx',
    capability_id: 'repository-inspector',
    state_version: 7,
    objective: 'inspect the current repository state',
    allowed_actions: ['observe_repository'],
    required_inputs: [],
    evidence_requirements: ['resolved prepared context'],
    timeout,
    resource_budget: { max_agent_calls: 1, max_tool_calls: 0 },
    expected_output_schema: { type: 'object', required: ['content'] },
    completion_conditions: ['provider returns non-empty content'],
    error_state: null,
    provenance: { requested_by: 'miss-vale-prime', created_at: '2026-09-18T00:00:00.000Z' },
  });
}

function boundContext(overrides = {}) {
  return Object.freeze({
    handle: `ctx_${'a'.repeat(32)}`,
    integritySha256: 'b'.repeat(64),
    missionId: 'mission-hardening',
    stateVersion: 7,
    stateHash: 'c'.repeat(64),
    reader: 'nyx',
    context: Object.freeze({ entries: Object.freeze([]) }),
    stats: Object.freeze({ selectedCount: 0 }),
    ...overrides,
  });
}

function preparedBinder(overrides = {}) {
  return Object.freeze({
    bind: async () => boundContext(),
    revalidate: async () => boundContext(),
    ...overrides,
  });
}

test('runtime rejects a forged composition that did not come from the composition factory', () => {
  const agent = fleetRegistry.agents.find((entry) => entry.id === 'nyx');
  const forged = Object.freeze({
    agent,
    capabilityId: agent.executorId,
    modelAdapter: safeModelAdapter(),
    toolAdapters: Object.freeze([]),
  });
  assert.throws(
    () => createAgentRuntime({ compositions: [forged] }),
    /canonical|branded.*composition|composition.*factory/i,
  );
});

test('composition rejects an unbranded remote adapter even when it claims no mission control', () => {
  assert.throws(
    () => createAgentComposition({
      agentId: 'nyx',
      capabilityId: 'repository-inspector',
      modelAdapter: {
        provider: 'remote-test',
        model: 'remote-test',
        capabilities: { mission_control: false, transport: 'remote' },
        complete: async () => ({ content: 'unsafe' }),
      },
    }),
    /canonical model adapter|branded model adapter/i,
  );
});

test('composition requires tool adapters to explicitly opt out of mission control', () => {
  for (const adapter of [
    {},
    { capabilities: {} },
    { capabilities: { mission_control: 'true' } },
  ]) {
    assert.throws(
      () => createAgentComposition({
        agentId: 'nyx',
        capabilityId: 'repository-inspector',
        modelAdapter: safeModelAdapter(),
        toolAdapters: [adapter],
      }),
      /capabilities are required|mission_control.*false|explicitly.*mission control/i,
    );
  }
});

test('composition rejects a forged progressive-skill facade', () => {
  assert.throws(
    () => createAgentComposition({
      agentId: 'nyx',
      capabilityId: 'repository-inspector',
      modelAdapter: safeModelAdapter(),
      skills: Object.freeze({
        list: () => Object.freeze([{ skillId: 'fabricated', procedure: ['unsafe'] }]),
        load: async () => Object.freeze({ skillId: 'fabricated', procedure: ['unsafe'] }),
      }),
    }),
    /progressive.*disclosure|branded.*skill|canonical.*skill/i,
  );
});

test('runtime validates the Prepared Context state hash before provider activation', async () => {
  let providerCalls = 0;
  const composition = createAgentComposition({
    agentId: 'nyx',
    capabilityId: 'repository-inspector',
    modelAdapter: createModelAdapter({
      provider: 'local',
      model: 'bad-state-hash-test',
      complete: async () => {
        providerCalls += 1;
        return { content: 'must not run' };
      },
    }),
    preparedContext: preparedBinder({
      bind: async () => boundContext({ stateHash: 'not-a-sha256' }),
    }),
  });
  const runtime = createAgentRuntime({ compositions: [composition] });
  await assert.rejects(
    () => runtime.respond({
      profile: 'owner',
      envelope: operationalEnvelope(),
      contextRequest: { query: { text: 'current mission' } },
    }),
    /state hash|prepared context.*invalid/i,
  );
  assert.equal(providerCalls, 0);
});

test('runtime derives a valid retrieval query from the envelope objective when query is omitted', async () => {
  let receivedQuery;
  const composition = createAgentComposition({
    agentId: 'nyx',
    capabilityId: 'repository-inspector',
    modelAdapter: safeModelAdapter(),
    preparedContext: preparedBinder({
      async bind(request) {
        receivedQuery = request.query;
        return boundContext();
      },
    }),
  });
  const runtime = createAgentRuntime({ compositions: [composition] });
  await runtime.respond({
    profile: 'owner',
    envelope: operationalEnvelope(),
    contextRequest: {},
  });
  assert.deepEqual(receivedQuery, { text: 'inspect the current repository state' });
});

test('runtime revalidates Prepared Context after asynchronous pre-agent hooks and before provider activation', async () => {
  const calls = [];
  const composition = createAgentComposition({
    agentId: 'nyx',
    capabilityId: 'repository-inspector',
    modelAdapter: createModelAdapter({
      provider: 'local',
      model: 'revalidate-order-test',
      complete: async () => {
        calls.push('provider');
        return { content: 'ok' };
      },
    }),
    hooks: Object.freeze({
      async run(phase) {
        calls.push(phase);
        return Object.freeze([]);
      },
    }),
    preparedContext: preparedBinder({
      async bind() {
        calls.push('bind');
        return boundContext();
      },
      async revalidate(bound) {
        calls.push('revalidate');
        assert.equal(bound.handle, `ctx_${'a'.repeat(32)}`);
        return bound;
      },
    }),
  });
  const runtime = createAgentRuntime({ compositions: [composition] });
  await runtime.respond({
    profile: 'owner',
    envelope: operationalEnvelope(),
    contextRequest: { query: { text: 'current mission' } },
  });
  assert.ok(calls.indexOf('revalidate') > calls.indexOf('before_agent'));
  assert.ok(calls.indexOf('revalidate') < calls.indexOf('provider'));
});

test('operation timeout bounds lifecycle hooks before provider execution', async () => {
  let providerCalls = 0;
  const composition = createAgentComposition({
    agentId: 'nyx',
    capabilityId: 'repository-inspector',
    modelAdapter: createModelAdapter({
      provider: 'local',
      model: 'hook-timeout-test',
      complete: async () => {
        providerCalls += 1;
        return { content: 'late' };
      },
    }),
    hooks: Object.freeze({
      async run(phase) {
        if (phase === 'before_context') await delay(75);
        return Object.freeze([]);
      },
    }),
    preparedContext: preparedBinder(),
  });
  const runtime = createAgentRuntime({ compositions: [composition] });
  await assert.rejects(
    () => runtime.respond({
      profile: 'owner',
      envelope: operationalEnvelope({ timeout: 15 }),
      contextRequest: { query: { text: 'current mission' } },
    }),
    /OPERATION_TIMEOUT|timed out/i,
  );
  assert.equal(providerCalls, 0);
});

test('operation timeout bounds Prepared Context binding before provider execution', async () => {
  let providerCalls = 0;
  const composition = createAgentComposition({
    agentId: 'nyx',
    capabilityId: 'repository-inspector',
    modelAdapter: createModelAdapter({
      provider: 'local',
      model: 'binder-timeout-test',
      complete: async () => {
        providerCalls += 1;
        return { content: 'late' };
      },
    }),
    preparedContext: preparedBinder({
      async bind() {
        await delay(75);
        return boundContext();
      },
    }),
  });
  const runtime = createAgentRuntime({ compositions: [composition] });
  await assert.rejects(
    () => runtime.respond({
      profile: 'owner',
      envelope: operationalEnvelope({ timeout: 15 }),
      contextRequest: { query: { text: 'current mission' } },
    }),
    /OPERATION_TIMEOUT|timed out/i,
  );
  assert.equal(providerCalls, 0);
});

test('Ollama serialization includes bounded Prepared Context when supplied', async () => {
  let requestBody;
  const complete = createOllamaCompletion({
    model: 'llama3.2:3b',
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return {
        ok: true,
        async json() {
          return { message: { content: 'ok' } };
        },
      };
    },
  });
  const preparedContext = boundContext({
    context: Object.freeze({
      entries: Object.freeze([
        Object.freeze({ memoryType: 'working', content: Object.freeze({ objective: 'current mission' }) }),
      ]),
    }),
  });
  await complete({
    agent: { id: 'nyx', name: 'NYX', role: 'repository inspector' },
    text: 'inspect current state',
    preparedContext,
  });
  const serialized = JSON.stringify(requestBody.messages);
  assert.match(serialized, /Prepared Context/i);
  assert.match(serialized, new RegExp(preparedContext.handle));
  assert.match(serialized, /current mission/);
});
