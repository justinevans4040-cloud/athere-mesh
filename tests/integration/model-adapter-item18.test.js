import test from 'node:test';
import assert from 'node:assert/strict';
import { createModelAdapter, createCompletionFromAdapter } from '../../packages/agent/src/model-adapter.js';
import { createOllamaCompletion } from '../../packages/agent/src/ollama-client.js';
import { createAgentRuntime } from '../../packages/agent/src/agent-runtime.js';
import { createTitanApi } from '../../packages/api/src/titan-api.js';

test('Item 18: ollama adapter preserves loopback binding and advisory-only completion', async () => {
  const adapter = createModelAdapter({
    provider: 'ollama',
    model: 'llama3.2:3b',
    baseUrl: 'http://127.0.0.1:11434',
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { message: { content: 'loopback ok' } };
      },
    }),
  });
  assert.equal(adapter.provider, 'ollama');
  assert.equal(adapter.capabilities.mission_control, false);
  const result = await adapter.complete({
    agent: { id: 'agent-vale', name: 'Agent Vale', role: 'customer_safe_specialist' },
    text: 'hi',
  });
  assert.deepEqual(result, { content: 'loopback ok' });
});

test('Item 18: titan chat still works when complete is built from a swapped adapter', async () => {
  const adapter = createModelAdapter({
    provider: 'claude',
    model: 'claude-test',
    allowRemote: true,
    complete: async () => ({ content: 'swapped provider reply' }),
  });
  const runtime = createAgentRuntime({ complete: createCompletionFromAdapter(adapter) });
  const api = createTitanApi({
    profile: 'owner',
    authToken: 'test-owner-token-0123456789abcdef0123456789',
    runtime,
    orchestrator: {
      async execute() { return { status: 'blocked', reason: 'unused' }; },
      async getMission() { return null; },
    },
  });
  await api.listen({ host: '127.0.0.1', port: 0 });
  try {
    const response = await fetch(`${api.url}/api/chat?agent=agent-vale`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-owner-token-0123456789abcdef0123456789',
        'content-type': 'text/plain; charset=utf-8',
      },
      body: 'status',
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.content, 'swapped provider reply');
  } finally {
    await api.close();
  }
});

test('Item 18: createOllamaCompletion remains available and matches adapter contract', async () => {
  const direct = createOllamaCompletion({
    model: 'llama3.2:3b',
    fetchImpl: async () => ({
      ok: true,
      async json() { return { message: { content: 'direct' } }; },
    }),
  });
  const viaAdapter = createModelAdapter({
    provider: 'ollama',
    model: 'llama3.2:3b',
    fetchImpl: async () => ({
      ok: true,
      async json() { return { message: { content: 'via-adapter' } }; },
    }),
  });
  const a = await direct({ agent: { id: 'agent-vale', name: 'Agent Vale', role: 'customer_safe_specialist' }, text: 'x' });
  const b = await viaAdapter.complete({ agent: { id: 'agent-vale', name: 'Agent Vale', role: 'customer_safe_specialist' }, text: 'x' });
  assert.equal(typeof a.content, 'string');
  assert.equal(typeof b.content, 'string');
});
