import test from 'node:test';
import assert from 'node:assert/strict';
import { createMissionOrchestrator } from '../../packages/orchestrator/src/mission-orchestrator.js';
import {
  resolveMeshOrchestratorDeps,
  truthyEnvFlag,
} from '../../packages/orchestrator/src/mesh-env-wiring.js';
import { createMemoryResonanceBus } from '../../packages/resonance/src/resonance-bus.js';

const SEED = '8a1e2c26-0769-405e-9a8f-85b4c2c9f1f1@ichabodcrane';

function offlineEnv(overrides = {}) {
  return {
    // Explicitly omit mesh Redis / Postgres so resolve stays offline.
    PATH: process.env.PATH,
    ...overrides,
  };
}

test('truthyEnvFlag accepts 1/true/yes/on and rejects empty or nonsense', () => {
  assert.equal(truthyEnvFlag('1'), true);
  assert.equal(truthyEnvFlag('true'), true);
  assert.equal(truthyEnvFlag('YES'), true);
  assert.equal(truthyEnvFlag('on'), true);
  assert.equal(truthyEnvFlag(''), false);
  assert.equal(truthyEnvFlag('0'), false);
  assert.equal(truthyEnvFlag('false'), false);
  assert.equal(truthyEnvFlag(undefined), false);
});

test('offline env leaves orchestrator on memory bus + no remote queue + no shared store', async () => {
  const deps = await resolveMeshOrchestratorDeps(offlineEnv());
  assert.equal(deps.bus, undefined);
  assert.equal(deps.remoteWorkQueue, undefined);
  assert.equal(deps.store, undefined);
  assert.equal(deps.remoteRepositoryRoot, undefined);
  assert.deepEqual(deps.wired, {
    redisBus: false,
    remoteWorkQueue: false,
    sharedMissionStore: false,
    sharedProofStore: false,
  });
  await deps.close();
});

test('remote work queue flag without Redis fails closed', async () => {
  await assert.rejects(
    () => resolveMeshOrchestratorDeps(offlineEnv({ ATHERE_MESH_REMOTE_WORK_QUEUE: '1' })),
    /ATHERE_MESH_REMOTE_WORK_QUEUE requires ATHERE_MESH_REDIS/,
  );
});

test('Redis env wires resonance bus with failClosedOnPublish; remote queue stays off without flag', async () => {
  const deps = await resolveMeshOrchestratorDeps(offlineEnv({
    ATHERE_MESH_REDIS_HOST: '127.0.0.1',
    ATHERE_MESH_REDIS_PORT: '6380',
    ATHERE_MESH_REDIS_SEED_ID: SEED,
    ATHERE_MESH_REDIS_PASSWORD: 'test-not-used-offline',
  }));
  try {
    assert.equal(deps.wired.redisBus, true);
    assert.equal(deps.wired.remoteWorkQueue, false);
    assert.equal(deps.bus?.failClosedOnPublish, true);
    assert.equal(typeof deps.bus?.publish, 'function');
    assert.equal(deps.remoteWorkQueue, undefined);
  } finally {
    await deps.close();
  }
});

test('Redis + remote work queue flag wires queue and optional remote repository root', async () => {
  const deps = await resolveMeshOrchestratorDeps(offlineEnv({
    ATHERE_MESH_REDIS_HOST: '127.0.0.1',
    ATHERE_MESH_REDIS_PORT: '6380',
    ATHERE_MESH_REDIS_SEED_ID: SEED,
    ATHERE_MESH_REDIS_PASSWORD: 'test-not-used-offline',
    ATHERE_MESH_REMOTE_WORK_QUEUE: 'true',
    ATHERE_MESH_REMOTE_REPOSITORY_ROOT: '/home/the_founder/athere-mesh',
    ATHERE_MESH_WORK_NAMESPACE: 'athere:mesh:work:test-wiring',
  }));
  try {
    assert.equal(deps.wired.redisBus, true);
    assert.equal(deps.wired.remoteWorkQueue, true);
    assert.equal(deps.bus?.failClosedOnPublish, true);
    assert.equal(typeof deps.remoteWorkQueue?.enqueue, 'function');
    assert.equal(typeof deps.remoteWorkQueue?.awaitResult, 'function');
    assert.equal(deps.remoteRepositoryRoot, '/home/the_founder/athere-mesh');
  } finally {
    await deps.close();
  }
});

test('createMissionOrchestrator accepts wired Redis bus fail-closed marker from env deps', async () => {
  const deps = await resolveMeshOrchestratorDeps(offlineEnv({
    ATHERE_MESH_REDIS_HOST: '127.0.0.1',
    ATHERE_MESH_REDIS_PORT: '6380',
    ATHERE_MESH_REDIS_SEED_ID: SEED,
    ATHERE_MESH_REDIS_PASSWORD: 'test-not-used-offline',
  }));
  try {
    // Construction only — do not run a mission against a live Redis in this
    // hermetic case. Prove the orchestrator accepts the wired bus shape.
    const orchestrator = createMissionOrchestrator({
      root: 'workspace/titan',
      repositoryRoot: process.cwd(),
      bus: deps.bus,
      executor: {
        async inspect() {
          return { package: {}, sourceFilesOnDisk: [], testFilesOnDisk: [] };
        },
        async runTests() {
          return {
            command: 'node --test',
            exitCode: 0,
            tests: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
            stdout: '',
            stderr: '',
          };
        },
      },
    });
    assert.equal(typeof orchestrator.execute, 'function');
    // Contrast: default memory bus does not fail closed.
    assert.equal(createMemoryResonanceBus().failClosedOnPublish, undefined);
    assert.equal(deps.bus.failClosedOnPublish, true);
  } finally {
    await deps.close();
  }
});
