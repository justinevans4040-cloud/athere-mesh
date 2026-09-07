import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { evaluateQr18Layers } from '../../packages/proof/src/qr18-layered-verification.js';
import { readProofBytes, verifyArtifactProof, writeArtifactProof, writeProof } from '../../packages/proof/src/proof-store.js';

const artifact = {
  id: 'mission-proof',
  artifactId: 'mission-proof',
  path: 'proofs/artifacts/x/mission-proof-deadbeef.json',
  operationId: 'op-art',
  verified: true,
  serviceVerified: true,
  artifactHash: 'a'.repeat(64),
  proofHash: 'b'.repeat(64),
  agent: 'qra_emerge_audit',
  action: 'verify_proof',
  verifierResult: { verifier: 'qra_emerge_audit', verified: true },
};

const proofOk = { verified: true, sha256: 'c'.repeat(64) };

/**
 * Item 10 hole: Level 1 used Set.length (always undefined) so ledger-only
 * performers never counted as action proof, while caller-planted evidence
 * alone could pass Level 1 with zero recorded performers.
 */
test('HOLE: QR18 Level 1 must verify from recorded performers, not planted evidence', () => {
  const ledgerMission = {
    status: 'running',
    objective: 'ledger action proof',
    evidence: [],
    completedWork: ['inspect'],
    pendingWork: [],
    failedWork: [],
    currentPlan: { id: 'p', version: 1, steps: ['inspect'] },
    artifactReferences: [artifact],
    transitionHistory: [{
      actor: 'nyx',
      action: 'observe_repository',
      changes: { evidence: { before: [], after: [{ agent: 'nyx' }] } },
    }],
  };
  const ledgerOnly = evaluateQr18Layers({
    mission: ledgerMission,
    proofVerification: proofOk,
    certifierAgentId: 'qra_emerge_audit',
    proofPayload: { completedWork: ledgerMission.completedWork },
  });
  assert.equal(ledgerOnly.levels[0].id, 'action');
  assert.equal(
    ledgerOnly.levels[0].verified,
    true,
    'HOLE: ledger-recorded performers must satisfy Level 1 even when evidence array is cleared',
  );
  assert.deepEqual(ledgerOnly.levels[0].evidence.recordedPerformers, ['nyx']);
  assert.equal(ledgerOnly.verified, true);

  const plantedOnly = evaluateQr18Layers({
    mission: {
      status: 'running',
      objective: 'planted evidence only',
      evidence: [{ agent: 'nyx', note: 'forged payload' }],
      completedWork: ['inspect'],
      pendingWork: [],
      failedWork: [],
      currentPlan: { id: 'p', version: 1, steps: ['inspect'] },
      artifactReferences: [artifact],
      transitionHistory: [{ actor: 'titan', action: 'create', changes: {} }],
    },
    proofVerification: proofOk,
    certifierAgentId: 'qra_emerge_audit',
    transitionHistory: [{ actor: 'titan', action: 'create', changes: {} }],
  });
  assert.equal(
    plantedOnly.levels[0].verified,
    false,
    'HOLE: planted evidence must not satisfy Level 1 without recorded performers',
  );
  assert.ok(plantedOnly.failedLevels.includes('action'));
});

test('service completion after evidence clear still traces Level 1 to ledger performers', async () => {
  const clock = () => '2026-09-05T15:10:00.000Z';
  const root = await mkdtemp(path.join(tmpdir(), 'athere-item10-clear-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create({
    operationId: 'op-i10-clear-create',
    id: 'mission-i10-clear-1',
    objective: 'clear then complete',
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
  const envelope = (record, operationId, agentId) => createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    objective: 'item10',
    createdAt: clock(),
  });
  const performed = await service.transition({
    operationId: 'op-i10-clear-nyx',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'work' },
    update: { evidence: [{ agent: 'nyx', note: 'real' }], activeAgents: ['nyx'] },
    envelope: envelope(created, 'op-i10-clear-nyx', 'nyx'),
  });
  const cleared = await service.transition({
    operationId: 'op-i10-clear-wipe',
    missionId: created.mission.id,
    expectedRevision: performed.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit', detail: 'clear evidence' },
    update: { evidence: [] },
    envelope: envelope(performed, 'op-i10-clear-wipe', 'qra_emerge_audit'),
  });
  const proof = await writeProof({
    root,
    missionId: created.mission.id,
    operationId: 'op-i10-clear-proof',
    payload: { result: 'ok', completedWork: ['inspect'] },
  });
  const proofBytes = await readProofBytes(root, proof);
  const artifactRef = await writeArtifactProof({
    root,
    missionId: created.mission.id,
    artifactId: 'mission-proof',
    artifact: proofBytes,
    operationId: 'op-i10-clear-artifact',
    predecessorHash: null,
    agent: 'qra_emerge_audit',
    action: 'verify_proof',
    verifierResult: { verifier: 'qra_emerge_audit', verified: true, proofSha256: proof.sha256 },
    missionStateVersion: cleared.revision,
    timestamp: clock(),
  });
  const artifactVerification = await verifyArtifactProof({ root, ref: artifactRef, artifact: proofBytes });
  const completed = await service.transition({
    operationId: 'op-i10-clear-complete',
    missionId: created.mission.id,
    expectedRevision: cleared.revision,
    signal: {
      type: 'completed',
      agent: 'qra_emerge_audit',
      proof: { ...proof, verified: true },
    },
    update: {
      completedWork: ['inspect'],
      pendingWork: [],
      failedWork: [],
      artifactReferences: [{ id: 'mission-proof', ...artifactRef, ...artifactVerification }],
    },
    envelope: envelope(cleared, 'op-i10-clear-complete', 'qra_emerge_audit'),
  });
  assert.equal(completed.mission.status, 'completed');
  assert.equal(completed.mission.result.qr18.levels[0].verified, true);
  assert.deepEqual(completed.mission.result.qr18.levels[0].evidence.recordedPerformers, ['nyx']);
  assert.equal(completed.mission.result.qr18.levels[0].evidence.evidenceEntries, 0);
});
