import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QR18_LEVELS,
  assertQr18LayersVerified,
  evaluateQr18Layers,
} from '../../packages/proof/src/qr18-layered-verification.js';

function honestMission(overrides = {}) {
  return {
    id: 'mission-qr18-1',
    status: 'running',
    objective: 'test all of Titan',
    intent: 'test all of Titan',
    evidence: [
      { agent: 'nyx', executor: 'repository-inspector', result: { sourceFilesOnDisk: 3 } },
      { agent: 'rune', executor: 'node-test-runner', result: { exitCode: 0, passed: 4 } },
    ],
    completedWork: ['inspect-repository', 'run-node-tests', 'verify-proof'],
    pendingWork: [],
    failedWork: [],
    currentPlan: { id: 'titan-test-plan', version: 1, steps: ['inspect-repository', 'run-node-tests', 'verify-proof'] },
    dependencies: [
      { prerequisite: 'inspect-repository', dependent: 'run-node-tests' },
      { prerequisite: 'run-node-tests', dependent: 'verify-proof' },
    ],
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
    transitionHistory: [
      {
        actor: 'nyx',
        action: 'observe_repository',
        changes: { evidence: { before: [], after: [{ agent: 'nyx' }] } },
      },
      {
        actor: 'rune',
        action: 'execute_node_tests',
        changes: { evidence: { before: [{ agent: 'nyx' }], after: [{ agent: 'nyx' }, { agent: 'rune' }] } },
      },
    ],
    ...overrides,
  };
}

const proofOk = { verified: true, sha256: 'c'.repeat(64) };

test('QR18 exposes exactly six named levels', () => {
  assert.equal(QR18_LEVELS.length, 6);
  assert.deepEqual(QR18_LEVELS.map(({ level, id }) => ({ level, id })), [
    { level: 1, id: 'action' },
    { level: 2, id: 'artifact' },
    { level: 3, id: 'state-transition' },
    { level: 4, id: 'subgoal' },
    { level: 5, id: 'workflow' },
    { level: 6, id: 'mission' },
  ]);
});

test('honest completion claim returns structured verified evidence at every QR18 level', () => {
  const qr18 = evaluateQr18Layers({
    mission: honestMission(),
    proofVerification: proofOk,
    certifierAgentId: 'qra_emerge_audit',
  });
  assert.equal(qr18.verifier, 'qr18');
  assert.equal(qr18.verified, true);
  assert.equal(qr18.levels.length, 6);
  for (const level of qr18.levels) {
    assert.equal(level.verified, true);
    assert.equal(typeof level.evidence, 'object');
    assert.ok(level.evidence);
  }
  assertQr18LayersVerified(qr18);
});

test('Level 1 rejects completion with no action evidence', () => {
  const qr18 = evaluateQr18Layers({
    mission: honestMission({ evidence: [], transitionHistory: [] }),
    proofVerification: proofOk,
    certifierAgentId: 'qra_emerge_audit',
  });
  assert.equal(qr18.verified, false);
  assert.ok(qr18.failedLevels.includes('action'));
  assert.equal(qr18.levels[0].verified, false);
});

test('Level 2 rejects completion without verified artifact lineage', () => {
  const qr18 = evaluateQr18Layers({
    mission: honestMission({ artifactReferences: [{ id: 'bare', verified: true }] }),
    proofVerification: proofOk,
    certifierAgentId: 'qra_emerge_audit',
  });
  assert.equal(qr18.levels[1].verified, false);
  assert.ok(qr18.failedLevels.includes('artifact'));
});

test('Level 3 rejects when the certifier is a recorded work performer', () => {
  const qr18 = evaluateQr18Layers({
    mission: honestMission(),
    proofVerification: proofOk,
    certifierAgentId: 'nyx',
  });
  assert.equal(qr18.levels[2].verified, false);
  assert.ok(qr18.failedLevels.includes('state-transition'));
});

test('Level 4 rejects when a plan step is missing from completedWork', () => {
  const qr18 = evaluateQr18Layers({
    mission: honestMission({ completedWork: ['inspect-repository', 'run-node-tests'] }),
    proofVerification: proofOk,
    certifierAgentId: 'qra_emerge_audit',
  });
  assert.equal(qr18.levels[3].verified, false);
  assert.ok(qr18.failedLevels.includes('subgoal'));
});

test('Level 5 rejects dependency violations and leftover pending/failed work', () => {
  const pending = evaluateQr18Layers({
    mission: honestMission({ pendingWork: ['verify-proof'], completedWork: ['inspect-repository', 'run-node-tests', 'verify-proof'] }),
    proofVerification: proofOk,
    certifierAgentId: 'qra_emerge_audit',
  });
  assert.ok(pending.failedLevels.includes('workflow'));

  const dependency = evaluateQr18Layers({
    mission: honestMission({
      completedWork: ['run-node-tests', 'verify-proof'],
      // inspect prerequisite missing while dependents claimed complete
    }),
    proofVerification: proofOk,
    certifierAgentId: 'qra_emerge_audit',
  });
  // subgoal also fails (inspect missing); workflow must still flag the dependency break
  assert.ok(dependency.failedLevels.includes('workflow'));
});

test('Level 6 rejects when mission proof verification failed', () => {
  const qr18 = evaluateQr18Layers({
    mission: honestMission(),
    proofVerification: { verified: false, sha256: 'c'.repeat(64), reason: 'hash_mismatch' },
    certifierAgentId: 'qra_emerge_audit',
  });
  assert.equal(qr18.levels[5].verified, false);
  assert.ok(qr18.failedLevels.includes('mission'));
});

test('assertQr18LayersVerified refuses forged or incomplete bags', () => {
  assert.throws(() => assertQr18LayersVerified({ verified: true }), /structured qr18/i);
  assert.throws(
    () => assertQr18LayersVerified({
      verifier: 'qr18',
      verified: false,
      levels: QR18_LEVELS.map((level) => ({ ...level, verified: false, evidence: {} })),
      failedLevels: ['action'],
    }),
    /failed: action/i,
  );
});

test('caller-supplied qr18 bag cannot satisfy evaluateQr18Layers — mission evidence is the source', () => {
  const qr18 = evaluateQr18Layers({
    mission: honestMission({
      evidence: [],
      transitionHistory: [],
      qr18: {
        verifier: 'qr18',
        verified: true,
        levels: QR18_LEVELS.map((level) => ({ ...level, verified: true, evidence: { forged: true } })),
        failedLevels: [],
      },
    }),
    proofVerification: proofOk,
    certifierAgentId: 'qra_emerge_audit',
  });
  assert.equal(qr18.verified, false);
  assert.ok(qr18.failedLevels.includes('action'));
});
