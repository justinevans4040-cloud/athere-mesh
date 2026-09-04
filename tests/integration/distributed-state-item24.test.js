import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { createDistributedMissionStore } from '../../packages/distributed/src/distributed-mission-store.js';
import { createMissionStore } from '../../packages/mission/src/mission-store.js';

function clock() {
  return '2026-09-05T12:00:00.000Z';
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
    operationId: 'op-dist-create-1',
    id: 'mission-dist-1',
    objective: 'distributed blackboard mission',
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

test('Item 24: replicas increase read capacity without weakening primary authority', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-dist-'));
  const primary = createMissionStore();
  const distributed = createDistributedMissionStore({
    primary,
    replicaCount: 3,
    shardCount: 4,
    now: clock,
  });
  const service = createMissionStateService({ root, clock, store: primary, distributed });
  const created = await service.create(createInput());

  const before = service.distributedTopology();
  assert.equal(before.singleWriter, true);
  assert.equal(before.multiMaster, false);
  const primaryLoadsBefore = before.primaryLoadCount;

  const replicas = await Promise.all([
    service.loadMissionReplica({ missionId: created.mission.id, replicaIndex: 0 }),
    service.loadMissionReplica({ missionId: created.mission.id, replicaIndex: 1 }),
    service.loadMissionReplica({ missionId: created.mission.id, replicaIndex: 2 }),
  ]);
  for (const snapshot of replicas) {
    assert.equal(snapshot.authoritative, false);
    assert.equal(snapshot.role, 'replica');
    assert.equal(snapshot.revision, created.revision);
    assert.equal(snapshot.mission.id, created.mission.id);
    assert.match(snapshot.shardId, /^shard-/);
  }

  const after = service.distributedTopology();
  assert.equal(after.replicaLoadCount, before.replicaLoadCount + 3);
  assert.equal(after.primaryLoadCount, primaryLoadsBefore);
  assert.ok(after.capacityReadsWithoutPrimary >= 3);

  const events = service.listMissionStateEvents({ missionId: created.mission.id });
  assert.ok(events.length >= 1);
  assert.equal(events[events.length - 1].authoritative, true);
  assert.equal(events[events.length - 1].revision, created.revision);

  const authoritative = await service.get({ missionId: created.mission.id });
  assert.equal(authoritative.revision, created.revision);
  assert.equal(service.resolveMissionShard(created.mission.id).startsWith('shard-'), true);
});

test('Item 24: transition forge of distributedState fails closed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-dist-forge-'));
  const service = createMissionStateService({ root, clock, distributed: true });
  const created = await service.create(createInput({ id: 'mission-dist-forge', operationId: 'op-dist-forge-create' }));
  await assert.rejects(
    () => service.transition({
      operationId: 'op-dist-forge',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx' },
      update: { distributedState: { multiMaster: true }, activeAgents: ['nyx'] },
    }),
    /envelope|distributedState|unsupported/,
  );
});
