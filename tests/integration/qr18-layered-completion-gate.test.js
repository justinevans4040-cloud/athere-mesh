import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { writeProof } from '../../packages/proof/src/proof-store.js';

function clock() {
  return '2026-09-04T04:00:00.000Z';
}

function createInput(overrides = {}) {
  return {
    operationId: 'op-qr18-gate-create-1',
    id: 'mission-qr18-gate-1',
    objective: 'test all of Titan',
    goals: [{ id: 'validate-titan', objective: 'Verify Titan' }],
    subgoals: [
      { id: 'inspect', goalId: 'validate-titan', objective: 'Inspect' },
      { id: 'verify', goalId: 'validate-titan', objective: 'Verify' },
    ],
    dependencies: [{ prerequisite: 'inspect', dependent: 'verify' }],
    currentPlan: { id: 'plan-1', version: 1, steps: ['inspect', 'verify'] },
    constraints: ['completion requires independently verified proof'],
    permissions: [
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
    ],
    environmentObservations: [],
    ...overrides,
  };
}

function envelopeFor(record, operationId, agentId) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    objective: `${agentId} operation`,
    createdAt: clock(),
  });
}

test('completion without verified artifact lineage fails QR18 Level 2 at the state service', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-qr18-gate-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput());
  const running = await service.transition({
    operationId: 'op-qr18-gate-running-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'miss-vale-prime', detail: 'supervise' },
    update: { activeAgents: ['miss-vale-prime'] },
    envelope: envelopeFor(created, 'op-qr18-gate-running-1', 'miss-vale-prime'),
  });
  const executed = await service.transition({
    operationId: 'op-qr18-gate-evidence-1',
    missionId: created.mission.id,
    expectedRevision: running.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'inspect evidence' },
    update: {
      evidence: [{ agent: 'nyx', executor: 'repository-inspector', result: { ok: true } }],
      activeAgents: ['nyx'],
    },
    envelope: envelopeFor(running, 'op-qr18-gate-evidence-1', 'nyx'),
  });
  const proof = await writeProof({
    root,
    missionId: created.mission.id,
    operationId: 'op-qr18-gate-proof-1',
    payload: { result: 'ok' },
  });

  await assert.rejects(
    () => service.transition({
      operationId: 'op-qr18-gate-complete-1',
      missionId: created.mission.id,
      expectedRevision: executed.revision,
      signal: {
        type: 'completed',
        agent: 'qra_emerge_audit',
        proof: { ...proof, verified: true },
        result: {
          // Forged bag must not bypass service evaluation.
          qr18: { verifier: 'qr18', verified: true, levels: [], failedLevels: [] },
        },
      },
      update: {
        completedWork: ['inspect', 'verify'],
        pendingWork: [],
        failedWork: [],
        activeAgents: [],
        // Missing artifactReferences → Level 2 fail
      },
      envelope: envelopeFor(executed, 'op-qr18-gate-complete-1', 'qra_emerge_audit'),
    }),
    /QR18 layered verification failed:.*artifact/i,
  );

  const after = await service.get({ missionId: created.mission.id });
  assert.notEqual(after.mission.status, 'completed');
});

test('honest completion stores service-evaluated QR18 levels on the mission result', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-qr18-honest-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({ id: 'mission-qr18-honest-1', operationId: 'op-qr18-honest-create-1' }));
  const running = await service.transition({
    operationId: 'op-qr18-honest-running-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'miss-vale-prime' },
    update: { activeAgents: ['miss-vale-prime'] },
    envelope: envelopeFor(created, 'op-qr18-honest-running-1', 'miss-vale-prime'),
  });
  const executed = await service.transition({
    operationId: 'op-qr18-honest-evidence-1',
    missionId: created.mission.id,
    expectedRevision: running.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: {
      evidence: [{ agent: 'nyx', executor: 'repository-inspector', result: { ok: true } }],
      activeAgents: ['nyx'],
    },
    envelope: envelopeFor(running, 'op-qr18-honest-evidence-1', 'nyx'),
  });
  const proof = await writeProof({
    root,
    missionId: created.mission.id,
    operationId: 'op-qr18-honest-proof-1',
    payload: { result: 'ok' },
  });

  const completed = await service.transition({
    operationId: 'op-qr18-honest-complete-1',
    missionId: created.mission.id,
    expectedRevision: executed.revision,
    signal: {
      type: 'completed',
      agent: 'qra_emerge_audit',
      proof: { ...proof, verified: true },
    },
    update: {
      completedWork: ['inspect', 'verify'],
      pendingWork: [],
      failedWork: [],
      activeAgents: [],
      artifactReferences: [{
        id: 'mission-proof',
        artifactId: 'mission-proof',
        verified: true,
        artifactHash: 'a'.repeat(64),
        proofHash: 'b'.repeat(64),
        agent: 'qra_emerge_audit',
        action: 'verified_mission_proof',
        verifierResult: { verifier: 'qra_emerge_audit', verified: true },
      }],
    },
    envelope: envelopeFor(executed, 'op-qr18-honest-complete-1', 'qra_emerge_audit'),
  });

  assert.equal(completed.mission.status, 'completed');
  assert.equal(completed.mission.result.qr18.verifier, 'qr18');
  assert.equal(completed.mission.result.qr18.verified, true);
  assert.equal(completed.mission.result.qr18.levels.length, 6);
  assert.deepEqual(
    completed.mission.result.qr18.levels.map(({ id, verified }) => ({ id, verified })),
    [
      { id: 'action', verified: true },
      { id: 'artifact', verified: true },
      { id: 'state-transition', verified: true },
      { id: 'subgoal', verified: true },
      { id: 'workflow', verified: true },
      { id: 'mission', verified: true },
    ],
  );
});
