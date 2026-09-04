import { createAgentRuntime } from '../packages/agent/src/agent-runtime.js';
import {
  createCompletionFromAdapter,
  createModelAdapter,
} from '../packages/agent/src/model-adapter.js';

const text = process.argv.slice(2).join(' ').trim();
if (!text) throw new Error('usage: pnpm chat -- your normal-language request');
const adapter = createModelAdapter({
  provider: process.env.ATHERE_MODEL_PROVIDER ?? 'ollama',
  model: process.env.ATHERE_MODEL ?? process.env.OLLAMA_MODEL ?? 'llama3.2:3b',
  allowRemote: process.env.ATHERE_MODEL_ALLOW_REMOTE === '1',
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
  timeoutMs: Number.parseInt(process.env.OLLAMA_TIMEOUT_MS ?? '120000', 10),
});
const runtime = createAgentRuntime({ complete: createCompletionFromAdapter(adapter) });
const response = await runtime.respond({
  profile: 'owner',
  agentId: process.env.TITAN_AGENT_ID ?? 'agent-vale',
  text,
});
process.stdout.write(`${response.content}\n`);
