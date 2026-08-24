import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentRuntime } from '../packages/agent/src/agent-runtime.js';
import { createOllamaCompletion } from '../packages/agent/src/ollama-client.js';
import { createTitanApi } from '../packages/api/src/titan-api.js';
import { createNodeTestExecutor } from '../packages/execution/src/node-test-executor.js';
import { fleetRegistry, validateOperationalFleet } from '../packages/fleet/src/registry.js';
import { createMissionOrchestrator } from '../packages/orchestrator/src/mission-orchestrator.js';
import { recoverInterruptedMissions } from '../packages/recovery/src/recovery-coordinator.js';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function positiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) throw new TypeError(`${label} must be a valid TCP port`);
  return parsed;
}

function nonEmptyEnvironment(environment, name, fallback) {
  const value = environment[name] ?? fallback;
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function workspaceRoot(environment, repositoryRoot) {
  const requested = environment.TITAN_WORKSPACE_ROOT ?? 'workspace/titan';
  const base = path.resolve(repositoryRoot, 'workspace');
  const segments = typeof requested === 'string' ? requested.split(/[\\/]+/) : [];
  if (typeof requested !== 'string' || requested.trim().length === 0 || path.isAbsolute(requested) || segments.includes('..')) {
    throw new Error('TITAN_WORKSPACE_ROOT must stay within repository workspace');
  }
  const resolved = path.resolve(repositoryRoot, requested);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error('TITAN_WORKSPACE_ROOT must stay within repository workspace');
  }
  return resolved;
}

export async function createTitanService({
  environment = process.env,
  repositoryRoot = scriptRoot,
} = {}) {
  if (!environment || typeof environment !== 'object') throw new TypeError('environment is required');
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  const resolvedWorkspaceRoot = workspaceRoot(environment, resolvedRepositoryRoot);
  validateOperationalFleet();
  await mkdir(resolvedWorkspaceRoot, { recursive: true });
  const recovery = await recoverInterruptedMissions({ root: resolvedWorkspaceRoot });
  const executor = createNodeTestExecutor({ repositoryRoot: resolvedRepositoryRoot });
  const orchestrator = createMissionOrchestrator({ root: resolvedWorkspaceRoot, repositoryRoot: resolvedRepositoryRoot, executor });
  const complete = createOllamaCompletion({
    baseUrl: nonEmptyEnvironment(environment, 'OLLAMA_BASE_URL', 'http://127.0.0.1:11434'),
    model: nonEmptyEnvironment(environment, 'OLLAMA_MODEL', 'llama3.2:3b'),
    timeoutMs: Number.parseInt(environment.OLLAMA_TIMEOUT_MS ?? '120000', 10),
  });
  const runtime = createAgentRuntime({ complete });
  return createTitanApi({ runtime, profile: 'owner', orchestrator, team: fleetRegistry, recovery });
}

export async function startTitanService({ environment = process.env, repositoryRoot = scriptRoot } = {}) {
  const api = await createTitanService({ environment, repositoryRoot });
  await api.listen({ host: '127.0.0.1', port: positiveInteger(environment.TITAN_API_PORT ?? '5050', 'TITAN_API_PORT') });
  return api;
}

if (import.meta.main) {
  const api = await startTitanService();
  process.stdout.write(`Titan agent API listening at ${api.url}\n`);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => {
      await api.close();
      process.exit(0);
    });
  }
}
