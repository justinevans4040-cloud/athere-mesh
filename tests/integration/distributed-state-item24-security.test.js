import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertCannotVerifyFromReplica } from '../../packages/contracts/src/distributed-state.js';
import {
  MAX_SHARDS,
  createDistributedMissionStore,
} from '../../packages/distributed/src/distributed-mission-store.js';
import { createMissionStore } from '../../packages/mission/src/mission-store.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

function clock() {
  return '2026-09-05T12:30:00.000Z';
}

const BASE_MISSION = {
  objective: 'secure distributed state',
  goals: [{ id: 'goal-1', objective: 'g' }],
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
  constraints: ['c'],
  permissions: [
    { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
    { actor: 'nyx', actions: ['observe_repository'] },
    { actor: 'rune', actions: ['execute_node_tests'] },
    { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
    {
      actor: 'qra_recovery_driver',
      actions: [
        'block_interrupted_mission',
        'create_checkpoint',
        'create_branch',
        'quarantine_branch',
        'rollback_to_checkpoint',
        'retry_from_checkpoint',
      ],
    },
  ],
  environmentObservations: [
    { source: 'titan', key: 'repository_root', value: '/tmp/repo', observedAt: clock() },
  ],
};

test('Item 24 security: unbranded distributed layer and unsafe mission ids fail closed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-dist-brand-'));
  const fake = {
    async loadMission() { return { revision: 1, mission: { id: 'x' } }; },
    async saveMission(args) { return { revision: 1, mission: args.mission }; },
    async loadMissionReplica() {
      return { revision: 1, mission: { id: 'x' }, authoritative: true, role: 'primary' };
    },
    topology() { return { singleWriter: false, multiMaster: true }; },
  };
  assert.throws(
    () => createMissionStateService({ root, clock, distributed: fake }),
    /branded distributedMissionStore/,
  );
  assert.throws(
    () => createDistributedMissionStore({
      primary: createMissionStore(),
      shardCount: MAX_SHARDS + 1,
      now: clock,
    }),
    /shardCount/,
  );
});

test('Item 24 security: replica write and forbidden distribution paths fail closed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-dist-sec-'));
  const primary = createMissionStore();
  const distributed = createDistributedMissionStore({ primary, replicaCount: 2, now: clock });
  const service = createMissionStateService({
    root,
    clock,
    store: primary,
    distributed,
  });
  await service.create({
    ...BASE_MISSION,
    operationId: 'op-sec-create',
    id: 'mission-dist-sec',
  });

  await assert.rejects(
    () => distributed.writeViaReplica({ mission: { id: 'mission-dist-sec' }, expectedRevision: 0 }),
    /write forbidden/,
  );
  assert.throws(() => distributed.promoteReplicaToWriter(), /replica_promote_to_writer/);
  assert.throws(() => distributed.enableMultiMasterWrite(), /multi_master_write/);
  assert.throws(() => distributed.proposeQuorumBypassCas(), /quorum_bypass_cas/);
  assert.throws(() => distributed.enableGeoDualPrimary(), /geo_dual_primary/);
  assert.throws(
    () => distributed.mergeAuthority(
      { revision: 1, stateHash: 'a' },
      { revision: 2, stateHash: 'b' },
    ),
    /crdt_authority_merge/,
  );

  const replica = await service.loadMissionReplica({ missionId: 'mission-dist-sec', replicaIndex: 0 });
  replica.mission.objective = 'mutated-via-replica';
  const authoritative = await service.get({ missionId: 'mission-dist-sec' });
  assert.notEqual(authoritative.mission.objective, 'mutated-via-replica');
  assert.throws(() => assertCannotVerifyFromReplica(replica), /verification/);

  await assert.rejects(
    () => service.loadMissionReplica({ missionId: 'mission-dist-sec', replicaIndex: 99 }),
    /unknown replica/,
  );
  await assert.rejects(
    () => service.loadMissionReplica({ missionId: '../etc/passwd', replicaIndex: 0 }),
    /invalid missionId/,
  );
});

test('Item 24 security: revision CAS still fails closed through distributed wrapper', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-dist-cas-'));
  const primary = createMissionStore();
  const distributed = createDistributedMissionStore({ primary, replicaCount: 1, now: clock });
  const service = createMissionStateService({ root, clock, store: primary, distributed });
  const created = await service.create({
    ...BASE_MISSION,
    operationId: 'op-cas-create',
    id: 'mission-dist-cas',
    objective: 'cas through wrapper',
  });

  await assert.rejects(
    () => distributed.saveMission({
      root,
      mission: created.mission,
      expectedRevision: created.revision - 1,
    }),
    /revision conflict/,
  );
});
