import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_PROVIDERS,
  assertControlProtocolInvariant,
  getModelCapability,
  listModelCapabilities,
} from '../../packages/contracts/src/model-capability-registry.js';
import {
  createModelAdapter,
  createCompletionFromAdapter,
} from '../../packages/agent/src/model-adapter.js';
import { createAgentRuntime } from '../../packages/agent/src/agent-runtime.js';

test('Item 18 contract: capability registry lists swappable providers', () => {
  for (const provider of ['ollama', 'openai', 'gemini', 'claude', 'local']) {
    assert.ok(MODEL_PROVIDERS.includes(provider), provider);
  }
  const caps = listModelCapabilities();
  assert.ok(caps.length >= 5);
  for (const entry of caps) {
    assert.equal(entry.mission_control, false);
    assertControlProtocolInvariant(entry);
  }
});

test('Item 18 contract: swapping providers does not change runtime control protocol', async () => {
  const ollamaLike = createModelAdapter({
    provider: 'local',
    model: 'local-test-a',
    complete: async () => ({ content: 'reply-a' }),
  });
  const openaiLike = createModelAdapter({
    provider: 'openai',
    model: 'gpt-test',
    allowRemote: true,
    complete: async () => ({ content: 'reply-b' }),
  });

  assert.equal(ollamaLike.capabilities.mission_control, false);
  assert.equal(openaiLike.capabilities.mission_control, false);
  assert.equal(ollamaLike.provider, 'local');
  assert.equal(openaiLike.provider, 'openai');

  const runtimeA = createAgentRuntime({ complete: createCompletionFromAdapter(ollamaLike) });
  const runtimeB = createAgentRuntime({ complete: createCompletionFromAdapter(openaiLike) });

  const a = await runtimeA.respond({ profile: 'public', agentId: 'agent-vale', text: 'hello' });
  const b = await runtimeB.respond({ profile: 'public', agentId: 'agent-vale', text: 'hello' });
  assert.equal(a.agentId, 'agent-vale');
  assert.equal(b.agentId, 'agent-vale');
  assert.equal(a.content, 'reply-a');
  assert.equal(b.content, 'reply-b');
  assert.equal(a.live, true);
  assert.equal(b.live, true);
});

test('Item 18 contract: remote providers fail closed without allowRemote; mission_control cannot be enabled', () => {
  assert.throws(
    () => createModelAdapter({
      provider: 'openai',
      model: 'gpt-test',
      complete: async () => ({ content: 'x' }),
    }),
    /allowRemote/,
  );
  assert.throws(
    () => assertControlProtocolInvariant({
      provider: 'openai',
      model: 'gpt-test',
      chat: true,
      mission_control: true,
    }),
    /mission_control/,
  );
  assert.throws(
    () => getModelCapability('not-a-provider', 'x'),
    /unknown model provider/,
  );
});
