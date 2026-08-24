import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentRuntime } from '../../packages/agent/src/agent-runtime.js';

test('registered Agent Vale returns the live provider content for normal text', async () => {
  const runtime = createAgentRuntime({
    complete: async () => ({ content: 'COPPER-MOON-4812\nThis reply came from the configured local model.' }),
  });
  assert.deepEqual(await runtime.respond({ profile: 'owner', agentId: 'agent-vale', text: 'Give me a live response.' }), {
    agentId: 'agent-vale',
    content: 'COPPER-MOON-4812\nThis reply came from the configured local model.',
    live: true,
  });
});

test('unknown agents are rejected instead of sent through a fabricated prompt', async () => {
  const runtime = createAgentRuntime({ complete: async () => ({ content: 'should not run' }) });
  await assert.rejects(
    () => runtime.respond({ profile: 'owner', agentId: 'made-up-agent', text: 'Hello' }),
    /unknown agent/i,
  );
});

test('disabled recovered agents are not routed to a completion provider', async () => {
  let completionCalls = 0;
  const runtime = createAgentRuntime({
    complete: async () => {
      completionCalls += 1;
      return { content: 'should not run' };
    },
  });
  await assert.rejects(
    () => runtime.respond({ profile: 'owner', agentId: 'loom', text: 'hello' }),
    /agent is not operational/,
  );
  assert.equal(completionCalls, 0);
});

test('public profile cannot invoke owner-only Vale Prime', async () => {
  const runtime = createAgentRuntime({ complete: async () => ({ content: 'should not run' }) });
  await assert.rejects(
    () => runtime.respond({ profile: 'public', agentId: 'miss-vale-prime', text: 'Hello' }),
    /owner-only/i,
  );
});

test('empty provider content is an explicit failure and never a canned live claim', async () => {
  const runtime = createAgentRuntime({ complete: async () => ({ content: '   ' }) });
  await assert.rejects(
    () => runtime.respond({ profile: 'owner', agentId: 'agent-vale', text: 'Hello' }),
    /empty response/i,
  );
});

test('empty human text is rejected before model execution', async () => {
  const runtime = createAgentRuntime({ complete: async () => ({ content: 'should not run' }) });
  await assert.rejects(
    () => runtime.respond({ profile: 'owner', agentId: 'agent-vale', text: '  ' }),
    /non-empty text/i,
  );
});
