import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { createDistributedMissionStore } from '../../packages/distributed/src/distributed-mission-store.js';
import { createMissionStore } from '../../packages/mission/src/mission-store.js';

function clock() {
  return '2026-09-05T14:00:00.000Z';
}

const RECOVERY_ACTIONS = [
  'block_interrupted_mission',
  'create_checkpoint',
  'create_branch',
  'quarantine_branch',
  'rollback_to_checkpoint',
  'retry_from_checkpoint',
];

function createInput(overrides = {}) {
  return {
    operationId: 'op-dist-durable-1',
    id: 'mission-dist-durable-1',
    objective: 'durable distributed replica mission',
    goals: [{ id: 'goal-1', objective: 'Reach the end' }],
    subgoals: [
      { id: 'inspect-repository', goalId: 'goal-1', objective: 'Inspect' },
      { id: 'run-node-tests', goalId: 'goal-1', objective: 'Test' },
      { id: 'verify-proof', goalId: 'goal-1', objective: 'Verify' },
    ],
    dependencies: [
      { prerequisite: 'inspect-repository', dependent: 'run-node-tests' },
      { prerequisite: 'run-node-tests', dependent: 'verify-proof' },
    ],
    currentPlan: { id: 'plan-1', version: 1, steps: ['inspect-repository', 'run-node-tests', 'verify-proof'] },
    constraints: ['completion requires independently verified proof'],
    permissions: [
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'rune', actions: ['execute_node_tests'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
      { actor: 'qra_recovery_driver', actions: [...RECOVERY_ACTIONS] },
    ],
    environmentObservations: [
      { source: 'titan', key: 'repository_root', value: '/tmp/repo', observedAt: clock() },
    ],
    ...overrides,
  };
}

test('Item 24: durable replicas allow cross-process capacity reads without primary authority', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-dist-durable-'));
  const durableReplicaDir = path.join(root, 'replicas');
  const writerPrimary = createMissionStore();
  const writerLayer = createDistributedMissionStore({
    primary: writerPrimary,
    replicaCount: 2,
    shardCount: 2,
    now: clock,
    durableReplicaDir,
  });
  const writer = createMissionStateService({
    root: path.join(root, 'writer'),
    clock,
    store: writerPrimary,
    distributed: writerLayer,
  });
  const created = await writer.create(createInput());

  // Separate process-equivalent layer: fresh in-memory maps, same durable dir, no writer primary touch.
  const readerPrimary = createMissionStore();
  const readerLayer = createDistributedMissionStore({
    primary: readerPrimary,
    replicaCount: 2,
    shardCount: 2,
    now: clock,
    durableReplicaDir,
  });
  const reader = createMissionStateService({
    root: path.join(root, 'reader'),
    clock,
    store: readerPrimary,
    distributed: readerLayer,
  });

  const before = reader.distributedTopology();
  assert.equal(before.durableReplicas, true);
  assert.equal(before.primaryLoadCount, 0);
  assert.equal(before.replicaLoadCount, 0);

  const snapshot = await reader.loadMissionReplica({
    missionId: created.mission.id,
    replicaIndex: 0,
  });
  assert.equal(snapshot.authoritative, false);
  assert.equal(snapshot.durable, true);
  assert.equal(snapshot.revision, created.revision);
  assert.equal(snapshot.mission.id, created.mission.id);

  const after = reader.distributedTopology();
  assert.equal(after.replicaLoadCount, 1);
  assert.equal(after.primaryLoadCount, 0);
  assert.equal(after.singleWriter, true);
  assert.equal(after.multiMaster, false);

  await assert.rejects(
    () => readerLayer.writeViaReplica({ missionId: created.mission.id }),
    /replica|authority|forbidden|cannot/i,
  );
});
