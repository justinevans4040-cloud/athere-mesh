import { createAgentRuntime } from '../packages/agent/src/agent-runtime.js';
import { createOllamaCompletion } from '../packages/agent/src/ollama-client.js';
import { createTitanApi } from '../packages/api/src/titan-api.js';

const port = Number.parseInt(process.env.TITAN_API_PORT ?? '5050', 10);
const complete = createOllamaCompletion({
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
  model: process.env.OLLAMA_MODEL ?? 'llama3.2:3b',
  timeoutMs: Number.parseInt(process.env.OLLAMA_TIMEOUT_MS ?? '120000', 10),
});
const runtime = createAgentRuntime({ complete });
const api = createTitanApi({ runtime, profile: 'owner' });
await api.listen({ host: '127.0.0.1', port });
process.stdout.write(`Titan agent API listening at ${api.url}\n`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await api.close();
    process.exit(0);
  });
}
