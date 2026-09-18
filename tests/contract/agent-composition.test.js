import test from 'node:test';
import assert from 'node:assert/strict';

import { createAgentComposition } from '../../packages/agent/src/agent-composition.js';
import { createModelAdapter } from '../../packages/agent/src/model-adapter.js';

function safeModelAdapter() {
  return createModelAdapter({
    provider: 'local',
    model: 'composition-test',
    complete: async () => ({ content: 'ok' }),
  });
}

test('composition resolves the canonical fleet agent and freezes valid configuration', () => {
  const composition = createAgentComposition({
    agentId: 'nyx',
    capabilityId: 'repository-inspector',
    modelAdapter: safeModelAdapter(),
  });
  assert.equal(composition.agent.id, 'nyx');
  assert.equal(composition.agent.name, 'NYX');
  assert.equal(composition.capabilityId, 'repository-inspector');
  assert.equal(composition.agent.executorId, 'repository-inspector');
  assert.ok(Object.isFrozen(composition));
  assert.ok(Object.isFrozen(composition.toolAdapters));
});

test('composition rejects unknown agents and capability mismatch', () => {
  assert.throws(
    () => createAgentComposition({
      agentId: 'made-up-agent',
      capabilityId: 'repository-inspector',
      modelAdapter: safeModelAdapter(),
    }),
    /unknown agent/i,
  );
  assert.throws(
    () => createAgentComposition({
      agentId: 'nyx',
      capabilityId: 'node-test-runner',
      modelAdapter: safeModelAdapter(),
    }),
    /capability/i,
  );
});

test('composition rejects model or tool adapters that claim mission control', () => {
  assert.throws(
    () => createAgentComposition({
      agentId: 'nyx',
      capabilityId: 'repository-inspector',
      modelAdapter: {
        complete: async () => ({ content: 'bad' }),
        capabilities: { mission_control: true },
      },
    }),
    /mission_control|control protocol/i,
  );
  assert.throws(
    () => createAgentComposition({
      agentId: 'nyx',
      capabilityId: 'repository-inspector',
      modelAdapter: safeModelAdapter(),
      toolAdapters: [{ protocol: 'mcp', capabilities: { mission_control: true } }],
    }),
    /mission_control|mission control/i,
  );
});

test('composition validates optional ergonomic interfaces without taking their authority', () => {
  const hooks = Object.freeze({ run: async () => Object.freeze([]) });
  const preparedContext = Object.freeze({ bind: async () => Object.freeze({}), revalidate: async (bound) => bound });
  const composition = createAgentComposition({
    agentId: 'nyx',
    capabilityId: 'repository-inspector',
    modelAdapter: safeModelAdapter(),
    hooks,
    preparedContext,
  });
  assert.equal(composition.hooks, hooks);
  assert.equal(composition.preparedContext, preparedContext);
  assert.equal('missionStore' in composition, false);
  assert.equal('proofStore' in composition, false);
});
