import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { loadMission, saveMission } from '../../packages/mission/src/mission-store.js';
import { readProofBytes, verifyArtifactProof, writeArtifactProof, writeProof } from '../../packages/proof/src/proof-store.js';

function clock() {
  return '2026-09-04T09:00:00.000Z';
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
    operationId: 'op-hostile12-create',
    id: 'mission-hostile12',
    objective: 'hostile item 12',
    goals: [{ id: 'g1', objective: 'G' }],
    subgoals: [
      { id: 'a', goalId: 'g1', objective: 'A' },
      { id: 'b', goalId: 'g1', objective: 'B' },
    ],
    dependencies: [{ prerequisite: 'a', dependent: 'b' }],
    currentPlan: { id: 'p1', version: 1, steps: ['a', 'b'] },
    constraints: ['proof'],
    permissions: [
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
      { actor: 'qra_recovery_driver', actions: [...RECOVERY_ACTIONS] },
    ],
    environmentObservations: [],
    ...overrides,
  };
}

function envelopeFor(record, operationId, agentId, action) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    action,
    objective: 'hostile',
    createdAt: clock(),
  });
}

test('Item 12 hostile: forged checkpoint mutation via transition is rejected', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-h12-forge-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput());
  const running = await service.transition({
    operationId: 'op-h12-run',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'miss-vale-prime' },
    update: { activeAgents: ['miss-vale-prime'] },
    envelope: envelopeFor(created, 'op-h12-run', 'miss-vale-prime'),
  });
  await assert.rejects(
    () => service.transition({
      operationId: 'op-h12-forge-ckpt',
      missionId: created.mission.id,
      expectedRevision: running.revision,
      signal: { type: 'running', agent: 'miss-vale-prime' },
      update: { checkpoints: [{ id: 'forged', verified: true, stateHash: '00'.repeat(32) }] },
      envelope: envelopeFor(running, 'op-h12-forge-ckpt', 'miss-vale-prime'),
    }),
    /checkpoints must be changed through recovery checkpoint operations/,
  );
});

test('Item 12 hostile: store-tampered checkpoint hash fails closed on rollback', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-h12-tamper-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({ id: 'mission-hostile12-tamper', operationId: 'op-h12-tamper-create' }));
  const running = await service.transition({
    operationId: 'op-h12-tamper-run',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: {
      evidence: [{ agent: 'nyx', ok: true }],
      activeAgents: ['nyx'],
    },
    envelope: envelopeFor(created, 'op-h12-tamper-run', 'nyx'),
  });
  const certified = await service.transition({
    operationId: 'op-h12-tamper-cert',
    missionId: created.mission.id,
    expectedRevision: running.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit' },
    update: { completedWork: ['a'], pendingWork: ['b'], activeAgents: [] },
    envelope: envelopeFor(running, 'op-h12-tamper-cert', 'qra_emerge_audit'),
  });
  const checkpointed = await service.createCheckpoint({
    operationId: 'op-h12-tamper-ckpt',
    missionId: created.mission.id,
    expectedRevision: certified.revision,
    label: 'good',
    envelope: envelopeFor(certified, 'op-h12-tamper-ckpt', 'qra_recovery_driver', 'create_checkpoint'),
  });
  const checkpointId = checkpointed.mission.checkpoints[0].id;

  const blocked = await service.transition({
    operationId: 'op-h12-tamper-block',
    missionId: created.mission.id,
    expectedRevision: checkpointed.revision,
    signal: { type: 'blocked', agent: 'qra_recovery_driver', detail: 'interrupt before tamper rollback' },
    update: { pendingWork: [], failedWork: ['b'], activeAgents: [] },
    envelope: envelopeFor(checkpointed, 'op-h12-tamper-block', 'qra_recovery_driver', 'block_interrupted_mission'),
  });

  const loaded = await loadMission({ root, missionId: created.mission.id });
  const tamperedCheckpoints = loaded.mission.checkpoints.map((entry) => (
    entry.id === checkpointId
      ? { ...entry, stateHash: 'ff'.repeat(32) }
      : entry
  ));
  await saveMission({
    root,
    expectedRevision: loaded.revision,
    mission: { ...loaded.mission, checkpoints: tamperedCheckpoints },
  });

  // F4: out-of-band store mutation breaks the hash-chained ledger — reads and
  // recovery must fail closed before any checkpoint-hash check runs.
  await assert.rejects(
    () => service.get({ missionId: created.mission.id }),
    /transition history does not match|state hash/,
  );
  await assert.rejects(
    () => service.rollbackToCheckpoint({
      operationId: 'op-h12-tamper-roll',
      missionId: created.mission.id,
      expectedRevision: blocked.revision,
      checkpointId,
      envelope: envelopeFor(blocked, 'op-h12-tamper-roll', 'qra_recovery_driver', 'rollback_to_checkpoint'),
    }),
    /transition history does not match|state hash|checkpoint integrity failed/,
  );
  assert.equal(blocked.mission.status, 'blocked');
});

test('Item 12 hostile: executor cannot create_branch even with forged recovery action override', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-h12-exec-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({
    id: 'mission-hostile12-exec',
    operationId: 'op-h12-exec-create',
    permissions: [
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'nyx', actions: ['observe_repository', 'create_branch'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
      { actor: 'qra_recovery_driver', actions: [...RECOVERY_ACTIONS] },
    ],
  }));
  const running = await service.transition({
    operationId: 'op-h12-exec-run',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: { evidence: [{ agent: 'nyx' }], activeAgents: ['nyx'] },
    envelope: envelopeFor(created, 'op-h12-exec-run', 'nyx'),
  });
  assert.throws(
    () => createAgentOperationEnvelope({
      record: running,
      operationId: 'op-h12-exec-branch',
      agentId: 'nyx',
      action: 'create_branch',
      objective: 'steal branch',
      createdAt: clock(),
    }),
    /cannot override action|cannot perform action create_branch/,
  );
});

test('Item 12 hostile: rollback/retry on completed mission fails closed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-h12-done-'));
  const service = createMissionStateService({ root, clock });

  // Sibling: out-of-band status=completed must not be readable (F4).
  const forged = await service.create(createInput({ id: 'mission-hostile12-forged', operationId: 'op-h12-forge-create' }));
  const forgedRun = await service.transition({
    operationId: 'op-h12-forge-run',
    missionId: forged.mission.id,
    expectedRevision: forged.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: { evidence: [{ agent: 'nyx', note: 'real' }], activeAgents: ['nyx'] },
    envelope: envelopeFor(forged, 'op-h12-forge-run', 'nyx'),
  });
  const forgedLoaded = await loadMission({ root, missionId: forged.mission.id });
  await saveMission({
    root,
    expectedRevision: forgedLoaded.revision,
    mission: { ...forgedLoaded.mission, status: 'completed', coms: 'DONE' },
  });
  await assert.rejects(
    () => service.get({ missionId: forged.mission.id }),
    /transition history does not match|state hash/,
  );
  assert.equal(forgedRun.mission.status, 'running');

  // Honest completion path: rollback/retry must refuse terminal missions.
  const created = await service.create(createInput({ id: 'mission-hostile12-done', operationId: 'op-h12-done-create' }));
  const running = await service.transition({
    operationId: 'op-h12-done-run',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: { evidence: [{ agent: 'nyx', note: 'real' }], activeAgents: ['nyx'] },
    envelope: envelopeFor(created, 'op-h12-done-run', 'nyx'),
  });
  const checkpointed = await service.createCheckpoint({
    operationId: 'op-h12-done-ckpt',
    missionId: created.mission.id,
    expectedRevision: running.revision,
    label: 'pre-complete',
    envelope: envelopeFor(running, 'op-h12-done-ckpt', 'qra_recovery_driver', 'create_checkpoint'),
  });
  await assert.rejects(
    () => service.rollbackToCheckpoint({
      operationId: 'op-h12-done-roll-running',
      missionId: created.mission.id,
      expectedRevision: checkpointed.revision,
      checkpointId: checkpointed.mission.checkpoints[0].id,
      envelope: envelopeFor(checkpointed, 'op-h12-done-roll-running', 'qra_recovery_driver', 'rollback_to_checkpoint'),
    }),
    /can only rollback or retry from a blocked mission/,
  );

  const proof = await writeProof({
    root,
    missionId: created.mission.id,
    operationId: 'op-h12-done-proof',
    payload: { result: 'ok', completedWork: ['a', 'b'] },
  });
  const proofBytes = await readProofBytes(root, proof);
  const artifactRef = await writeArtifactProof({
    root,
    missionId: created.mission.id,
    artifactId: 'mission-proof',
    artifact: proofBytes,
    operationId: 'op-h12-done-artifact',
    predecessorHash: null,
    agent: 'qra_emerge_audit',
    action: 'verify_proof',
    verifierResult: { verifier: 'qra_emerge_audit', verified: true, proofSha256: proof.sha256 },
    missionStateVersion: checkpointed.revision,
    timestamp: clock(),
  });
  const artifactVerification = await verifyArtifactProof({ root, ref: artifactRef, artifact: proofBytes });
  const done = await service.transition({
    operationId: 'op-h12-done-complete',
    missionId: created.mission.id,
    expectedRevision: checkpointed.revision,
    signal: {
      type: 'completed',
      agent: 'qra_emerge_audit',
      proof: { ...proof, verified: true },
    },
    update: {
      completedWork: ['a', 'b'],
      pendingWork: [],
      failedWork: [],
      activeAgents: [],
      artifactReferences: [{ id: 'mission-proof', ...artifactRef, ...artifactVerification }],
    },
    envelope: envelopeFor(checkpointed, 'op-h12-done-complete', 'qra_emerge_audit'),
  });
  assert.equal(done.mission.status, 'completed');

  await assert.rejects(
    () => service.rollbackToCheckpoint({
      operationId: 'op-h12-done-roll',
      missionId: created.mission.id,
      expectedRevision: done.revision,
      checkpointId: checkpointed.mission.checkpoints[0].id,
      envelope: envelopeFor(done, 'op-h12-done-roll', 'qra_recovery_driver', 'rollback_to_checkpoint'),
    }),
    /cannot rollback or retry a completed mission/,
  );
  await assert.rejects(
    () => service.retryFromCheckpoint({
      operationId: 'op-h12-done-retry',
      missionId: created.mission.id,
      expectedRevision: done.revision,
      checkpointId: checkpointed.mission.checkpoints[0].id,
      envelope: envelopeFor(done, 'op-h12-done-retry', 'qra_recovery_driver', 'retry_from_checkpoint'),
    }),
    /cannot rollback or retry a completed mission/,
  );
});
