import { createAgentRuntime } from '../packages/agent/src/agent-runtime.js';
import { createOllamaCompletion } from '../packages/agent/src/ollama-client.js';

const text = process.argv.slice(2).join(' ').trim();
if (!text) throw new Error('usage: pnpm chat -- your normal-language request');
const complete = createOllamaCompletion({
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434',
  model: process.env.OLLAMA_MODEL ?? 'llama3.2:3b',
  timeoutMs: Number.parseInt(process.env.OLLAMA_TIMEOUT_MS ?? '120000', 10),
});
const runtime = createAgentRuntime({ complete });
const response = await runtime.respond({
  profile: 'owner',
  agentId: process.env.TITAN_AGENT_ID ?? 'agent-vale',
  text,
});
process.stdout.write(`${response.content}\n`);
