import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentRuntime } from '../../packages/agent/src/agent-runtime.js';
import { createTitanApi } from '../../packages/api/src/titan-api.js';

test('chat API accepts normal text without requiring JSON', async () => {
  const runtime = createAgentRuntime({ complete: async () => ({ content: 'A live Titan response.' }) });
  const api = createTitanApi({ runtime });
  await api.listen({ host: '127.0.0.1', port: 0 });
  try {
    const response = await fetch(`${api.url}/api/chat?agent=agent-vale`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain; charset=utf-8' },
      body: 'Tell me the current mission status.',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { agentId: 'agent-vale', content: 'A live Titan response.', live: true });
  } finally {
    await api.close();
  }
});

test('chat API rejects oversized text before model execution', async () => {
  const runtime = createAgentRuntime({ complete: async () => ({ content: 'should not run' }) });
  const api = createTitanApi({ runtime, maxRequestBytes: 32 });
  await api.listen({ host: '127.0.0.1', port: 0 });
  try {
    const response = await fetch(`${api.url}/api/chat?agent=agent-vale`, { method: 'POST', body: 'x'.repeat(33) });
    assert.equal(response.status, 413);
  } finally {
    await api.close();
  }
});

test('chat API directs recognized execution requests to the command endpoint', async () => {
  let completionCalls = 0;
  const runtime = createAgentRuntime({
    complete: async () => {
      completionCalls += 1;
      return { content: 'should not run' };
    },
  });
  const api = createTitanApi({ runtime });
  await api.listen({ host: '127.0.0.1', port: 0 });
  try {
    const postChat = async (text) => {
      const response = await fetch(`${api.url}/api/chat?agent=agent-vale`, { method: 'POST', body: text });
      return response.status;
    };
    assert.equal(await postChat('Run all Titan tests'), 409);
    assert.equal(completionCalls, 0);
  } finally {
    await api.close();
  }
});

test('chat API never sends denied recognized execution requests to the advisory model', async () => {
  let completionCalls = 0;
  const runtime = createAgentRuntime({
    complete: async () => {
      completionCalls += 1;
      return { content: 'should not run' };
    },
  });
  const api = createTitanApi({ runtime, profile: 'public' });
  await api.listen({ host: '127.0.0.1', port: 0 });
  try {
    const response = await fetch(`${api.url}/api/chat?agent=agent-vale`, { method: 'POST', body: 'Run all Titan tests' });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: 'execution request must use /api/commands' });
    assert.equal(completionCalls, 0);
  } finally {
    await api.close();
  }
});
