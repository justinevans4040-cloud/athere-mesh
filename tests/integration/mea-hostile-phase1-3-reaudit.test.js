import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { recordedWorkPerformers } from '../../packages/contracts/src/execution-roles.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { createMissionStoreBridge, defaultMissionStore } from '../../packages/mission/src/mission-store.js';
import { writeProof } from '../../packages/proof/src/proof-store.js';

const clock = () => '2026-09-05T21:00:00.000Z';

function envelope(record, operationId, agentId) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    objective: 'phase1-3 hostile',
    createdAt: clock(),
  });
}

/**
 * Phase 1–3 hostile: Item 6/10 — self-attested artifactReferences must not
 * satisfy completion. QR18 L2 / service boundary must bind to proof-store bytes.
 */
test('HOLE: forged artifactReferences cannot complete a mission', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-p123-forged-art-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create({
    operationId: 'op-forged-art-create',
    id: 'mission-forged-art-1',
    objective: 'forged artifact probe',
    goals: [{ id: 'g1', objective: 'g' }],
    subgoals: [{ id: 'inspect', goalId: 'g1', objective: 'inspect' }],
    dependencies: [],
    constraints: [],
    permissions: [
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
    ],
    currentPlan: { id: 'p1', version: 1, steps: ['inspect'] },
    environmentObservations: [],
  });
  const performed = await service.transition({
    operationId: 'op-forged-art-nyx',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'work' },
    update: { evidence: [{ agent: 'nyx', note: 'real' }], activeAgents: ['nyx'] },
    envelope: envelope(created, 'op-forged-art-nyx', 'nyx'),
  });
  const proof = await writeProof({
    root,
    missionId: created.mission.id,
    operationId: 'op-forged-art-proof',
    payload: { result: 'ok', completedWork: ['inspect'] },
  });
  await assert.rejects(
    () => service.transition({
      operationId: 'op-forged-art-complete',
      missionId: created.mission.id,
      expectedRevision: performed.revision,
      signal: {
        type: 'completed',
        agent: 'qra_emerge_audit',
        proof: { ...proof, verified: true },
      },
      update: {
        completedWork: ['inspect'],
        pendingWork: [],
        failedWork: [],
        artifactReferences: [{
          id: 'mission-proof',
          artifactId: 'mission-proof',
          verified: true,
          artifactHash: 'a'.repeat(64),
          proofHash: 'b'.repeat(64),
          agent: 'qra_emerge_audit',
          action: 'verify_proof',
          verifierResult: { verifier: 'qra_emerge_audit', verified: true },
        }],
      },
      envelope: envelope(performed, 'op-forged-art-complete', 'qra_emerge_audit'),
    }),
    /artifact provenance|invalid artifact|QR18 layered verification failed:.*artifact/i,
  );
  assert.notEqual((await service.get({ missionId: created.mission.id })).mission.status, 'completed');
});

/**
 * Phase 1–3 hostile: Item 9/10 — executor heartbeat (no evidence write) must not
 * count as recorded work performance for vacuum/L1 gates.
 */
test('HOLE: executor noop heartbeat cannot satisfy recorded performers for completion', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-p123-noop-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create({
    operationId: 'op-noop-create',
    id: 'mission-noop-1',
    objective: 'noop performer probe',
    goals: [{ id: 'g1', objective: 'g' }],
    subgoals: [{ id: 'inspect', goalId: 'g1', objective: 'inspect' }],
    dependencies: [],
    constraints: [],
    permissions: [
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
    ],
    currentPlan: { id: 'p1', version: 1, steps: ['inspect'] },
    environmentObservations: [],
  });
  const heartbeat = await service.transition({
    operationId: 'op-noop-nyx',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'heartbeat only' },
    update: { activeAgents: ['nyx'] },
    envelope: envelope(created, 'op-noop-nyx', 'nyx'),
  });
  assert.deepEqual(
    [...recordedWorkPerformers(heartbeat.mission.transitionHistory)],
    [],
    'HOLE: noop executor action alone must not be a recorded performer',
  );
  const proof = await writeProof({
    root,
    missionId: created.mission.id,
    operationId: 'op-noop-proof',
    payload: { result: 'ok', completedWork: ['inspect'] },
  });
  await assert.rejects(
    () => service.transition({
      operationId: 'op-noop-complete',
      missionId: created.mission.id,
      expectedRevision: heartbeat.revision,
      signal: {
        type: 'completed',
        agent: 'qra_emerge_audit',
        proof: { ...proof, verified: true },
      },
      update: {
        completedWork: ['inspect'],
        pendingWork: [],
        failedWork: [],
        artifactReferences: [{
          id: 'mission-proof',
          artifactId: 'mission-proof',
          verified: true,
          artifactHash: 'a'.repeat(64),
          proofHash: 'b'.repeat(64),
          agent: 'qra_emerge_audit',
          action: 'verify_proof',
          verifierResult: { verifier: 'qra_emerge_audit', verified: true },
        }],
      },
      envelope: envelope(heartbeat, 'op-noop-complete', 'qra_emerge_audit'),
    }),
    /cannot certify success without recorded work performers/,
  );
});

test('HOLE: empty-object evidence must not count as recorded performance', () => {
  assert.deepEqual(
    [...recordedWorkPerformers([
      {
        actor: 'nyx',
        action: 'observe_repository',
        changes: { evidence: { before: [], after: [{}] } },
      },
    ])],
    [],
  );
  assert.deepEqual(
    [...recordedWorkPerformers([
      {
        actor: 'nyx',
        action: 'observe_repository',
        changes: { evidence: { before: [], after: [{ verified: true }] } },
      },
    ])],
    [],
  );
  assert.deepEqual(
    [...recordedWorkPerformers([
      {
        actor: 'nyx',
        action: 'observe_repository',
        changes: { evidence: { before: [], after: [{ note: '   ' }] } },
      },
    ])],
    [],
  );
  assert.deepEqual(
    [...recordedWorkPerformers([
      {
        actor: 'nyx',
        action: 'observe_repository',
        changes: { evidence: { before: [], after: [{ agent: 'nyx', note: 'real' }] } },
      },
    ])],
    ['nyx'],
  );
});

test('HOLE: recovery and fact mutations must reject a tampered ledger', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-p123-f4-bypass-'));
  let tamper = false;
  const store = createMissionStoreBridge({
    saveMission: defaultMissionStore.saveMission,
    async loadMission(options) {
      const record = await defaultMissionStore.loadMission(options);
      if (!tamper) return record;
      const history = structuredClone(record.mission.transitionHistory);
      history[0].actor = 'intruder';
      return { ...record, mission: { ...record.mission, transitionHistory: history } };
    },
  });
  const service = createMissionStateService({ root, clock, store });
  const created = await service.create({
    operationId: 'op-f4-bypass-create',
    id: 'mission-f4-bypass-1',
    objective: 'f4 bypass',
    goals: [{ id: 'g1', objective: 'g' }],
    subgoals: [{ id: 'inspect', goalId: 'g1', objective: 'i' }],
    dependencies: [],
    constraints: [],
    permissions: [
      { actor: 'nyx', actions: ['observe_repository', 'record_fact'] },
      { actor: 'qra_recovery_driver', actions: ['create_checkpoint', 'block_interrupted_mission'] },
    ],
    currentPlan: { id: 'p1', version: 1, steps: ['inspect'] },
    environmentObservations: [],
  });
  const performed = await service.transition({
    operationId: 'op-f4-bypass-nyx',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: { evidence: [{ agent: 'nyx', note: 'real' }], activeAgents: ['nyx'] },
    envelope: envelope(created, 'op-f4-bypass-nyx', 'nyx'),
  });
  tamper = true;
  await assert.rejects(
    () => service.createCheckpoint({
      operationId: 'op-f4-bypass-ckpt',
      missionId: created.mission.id,
      expectedRevision: performed.revision,
      label: 'hostile',
      envelope: createAgentOperationEnvelope({
        record: performed,
        operationId: 'op-f4-bypass-ckpt',
        agentId: 'qra_recovery_driver',
        objective: 'ckpt',
        createdAt: clock(),
        action: 'create_checkpoint',
      }),
    }),
    /transition hash mismatch/,
  );
  await assert.rejects(
    () => service.recordFact({
      operationId: 'op-f4-bypass-fact',
      missionId: created.mission.id,
      expectedRevision: performed.revision,
      actor: 'nyx',
      fact: { id: 'fact-1', key: 'k', value: true, status: 'current' },
      envelope: createAgentOperationEnvelope({
        record: performed,
        operationId: 'op-f4-bypass-fact',
        agentId: 'nyx',
        action: 'record_fact',
        objective: 'fact',
        createdAt: clock(),
      }),
    }),
    /transition hash mismatch/,
  );
});
