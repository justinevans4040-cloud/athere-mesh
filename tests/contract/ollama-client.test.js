import test from 'node:test';
import assert from 'node:assert/strict';
import { createOllamaCompletion } from '../../packages/agent/src/ollama-client.js';

test('Ollama completion sends one bounded non-streaming agent conversation', async () => {
  let request;
  const complete = createOllamaCompletion({
    baseUrl: 'http://127.0.0.1:11434',
    model: 'llama3.2:3b',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ message: { role: 'assistant', content: 'Live local reply.' }, done: true }), { status: 200 });
    },
  });
  assert.deepEqual(await complete({ agent: { id: 'agent-vale', name: 'Agent Vale', role: 'customer_safe_specialist' }, text: 'Status please.' }), { content: 'Live local reply.' });
  assert.equal(request.url, 'http://127.0.0.1:11434/api/chat');
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.model, 'llama3.2:3b');
  assert.equal(payload.stream, false);
  assert.equal(payload.options.num_ctx, 8192);
  assert.equal(payload.messages.length, 2);
  assert.equal(payload.messages[1].content, 'Status please.');
});

test('Ollama completion refuses a non-loopback model endpoint', () => {
  assert.throws(
    () => createOllamaCompletion({ baseUrl: 'https://model.example.com', model: 'llama3.2:3b' }),
    /loopback/i,
  );
});

test('Ollama completion reports HTTP failure without reflecting response content', async () => {
  const complete = createOllamaCompletion({
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2:3b',
    fetchImpl: async () => new Response('secret upstream diagnostic', { status: 500 }),
  });
  await assert.rejects(
    () => complete({ agent: { id: 'agent-vale', name: 'Agent Vale', role: 'customer_safe_specialist' }, text: 'Hello' }),
    (error) => error.message === 'Ollama request failed with HTTP 500',
  );
});

test('Ollama completion rejects malformed success payloads', async () => {
  const complete = createOllamaCompletion({
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2:3b',
    fetchImpl: async () => new Response(JSON.stringify({ done: true }), { status: 200 }),
  });
  await assert.rejects(
    () => complete({ agent: { id: 'agent-vale', name: 'Agent Vale', role: 'customer_safe_specialist' }, text: 'Hello' }),
    /malformed response/i,
  );
});
