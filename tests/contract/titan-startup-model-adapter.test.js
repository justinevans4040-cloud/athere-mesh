import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createModelAdapter } from '../../packages/agent/src/model-adapter.js';
import { createTitanService } from '../../scripts/start-agent-api.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TOKEN = 'T'.repeat(48);

function environment(workspaceName) {
  return {
    TITAN_API_BEARER_TOKEN: TOKEN,
    TITAN_WORKSPACE_ROOT: `workspace/${workspaceName}`,
    OLLAMA_BASE_URL: 'http://127.0.0.1:9',
    OLLAMA_MODEL: 'llama3.2:3b',
    OLLAMA_TIMEOUT_MS: '100',
  };
}

function meshFixture() {
  let closed = false;
  return {
    deps: {
      wired: Object.freeze({ mode: 'test' }),
      async close() { closed = true; },
    },
    wasClosed: () => closed,
  };
}

test('Titan startup rejects an injected model adapter that claims mission control', async () => {
  const mesh = meshFixture();
  const workspaceName = `startup-bad-adapter-${process.pid}`;
  try {
    await assert.rejects(
      () => createTitanService({
        environment: environment(workspaceName),
        repositoryRoot,
        meshDeps: mesh.deps,
        modelAdapter: {
          capabilities: { mission_control: true },
          complete: async () => ({ content: 'unsafe' }),
        },
      }),
      /mission_control|control protocol/i,
    );
  } finally {
    await rm(path.join(repositoryRoot, 'workspace', workspaceName), { recursive: true, force: true });
  }
});

test('Titan advisory chat uses the injected canonical model adapter without reaching Ollama', async () => {
  const mesh = meshFixture();
  const workspaceName = `startup-good-adapter-${process.pid}`;
  const modelAdapter = createModelAdapter({
    provider: 'local',
    model: 'startup-test',
    complete: async () => ({ content: 'injected-model-response' }),
  });
  let service;
  try {
    service = await createTitanService({
      environment: environment(workspaceName),
      repositoryRoot,
      meshDeps: mesh.deps,
      modelAdapter,
    });
    await service.listen({ host: '127.0.0.1', port: 0 });
    const response = await fetch(`${service.url}/api/chat?agent=agent-vale`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'text/plain; charset=utf-8',
      },
      body: 'Give me a normal advisory response.',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      agentId: 'agent-vale',
      content: 'injected-model-response',
      live: true,
    });
  } finally {
    await service?.close();
    assert.equal(mesh.wasClosed(), true);
    await rm(path.join(repositoryRoot, 'workspace', workspaceName), { recursive: true, force: true });
  }
});
