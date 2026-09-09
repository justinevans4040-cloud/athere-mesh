import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateAuditLadder,
  runAuditLadderLoop,
  assertSliceAuditFloor,
} from '../../packages/proof/src/step-ladder-audit-loop.js';
import { QR18_LEVELS } from '../../packages/proof/src/qr18-layered-verification.js';

function inspectSliceMission() {
  return {
    id: 'mission-ladder-1',
    status: 'running',
    objective: 'test all of Titan',
    evidence: [{ agent: 'nyx', executor: 'repository-inspector', result: { sourceFilesOnDisk: 3 } }],
    completedWork: [],
    pendingWork: ['inspect-repository', 'run-node-tests', 'verify-proof'],
    failedWork: [],
    currentPlan: { id: 'titan-test-plan', version: 1, steps: ['inspect-repository', 'run-node-tests', 'verify-proof'] },
    artifactReferences: [],
    // Master residual close: Level 1 reads recorded performers from ledger evidence writes,
    // not planted evidence alone.
    transitionHistory: [{
      actor: 'nyx',
      action: 'observe_repository',
      changes: { evidence: { before: [], after: [{ agent: 'nyx', executor: 'repository-inspector' }] } },
    }],
  };
}

test('audit ladder walks QR18 rungs in order and does not self-certify after one slice', () => {
  const walked = [];
  let result;
  for (let step = 0; step < QR18_LEVELS.length; step += 1) {
    result = runAuditLadderLoop({
      mission: inspectSliceMission(),
      certifierAgentId: 'qra_emerge_audit',
      transitionHistory: inspectSliceMission().transitionHistory,
    });
    walked.push(result.nextRung?.id ?? 'certified');
    if (result.loop !== 'continue') break;
  }
  assert.equal(result.loop, 'continue');
  assert.equal(result.certified, false);
  assert.equal(result.nextRung.id, 'artifact');
  assert.deepEqual(result.walked.map((entry) => entry.id), ['action', 'artifact']);
  assert.equal(result.walked[0].verified, true);
  assert.equal(result.walked[1].verified, false);
  assert.equal(walked.every((id) => id === 'artifact'), true);
});

test('claiming certify before remaining rungs fail closed', () => {
  assert.throws(
    () => runAuditLadderLoop({
      mission: inspectSliceMission(),
      certifierAgentId: 'qra_emerge_audit',
      claimCertified: true,
    }),
    /completion claimed before rungs/,
  );
});

test('slice floor requires action proof after inspect', () => {
  const ladder = evaluateAuditLadder({
    mission: { ...inspectSliceMission(), evidence: [], transitionHistory: [] },
    certifierAgentId: 'qra_emerge_audit',
  });
  assert.throws(
    () => assertSliceAuditFloor({ ladder: runAuditLadderLoop({ mission: { ...inspectSliceMission(), evidence: [], transitionHistory: [] } }), slice: 'after-inspect' }),
    /action proof missing/,
  );
  void ladder;
});
