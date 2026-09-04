import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import {
  assessMissionPath,
  buildWorkflowGraph,
} from '../../packages/contracts/src/workflow-graph.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { evaluateQr18Layers } from '../../packages/proof/src/qr18-layered-verification.js';
import { writeProof } from '../../packages/proof/src/proof-store.js';

/**
 * Hostile re-audit after Item 10/11 READY claims.
 * Each case that ACCEPTs incorrectly is a live hole — leave RED, do not soft-pass.
 */

function clock() {
  return '2026-09-04T06:00:00.000Z';
}

function envelopeFor(record, operationId, agentId) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    objective: `${agentId} hostile probe`,
    createdAt: clock(),
  });
}

function baseCreate(overrides = {}) {
  return {
    operationId: 'op-hostile-create-1',
    id: 'mission-hostile-1',
    objective: 'hostile path probe',
    goals: [{ id: 'g1', objective: 'goal' }],
    subgoals: [
      { id: 'a', goalId: 'g1', objective: 'a' },
      { id: 'b', goalId: 'g1', objective: 'b' },
      { id: 'c', goalId: 'g1', objective: 'c' },
    ],
    dependencies: [
      { prerequisite: 'a', dependent: 'b' },
      { prerequisite: 'b', dependent: 'c' },
    ],
    currentPlan: { id: 'p1', version: 1, steps: ['a', 'b', 'c'] },
    constraints: ['no model-authored completion'],
    permissions: [
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
    ],
    environmentObservations: [],
    ...overrides,
  };
}

test('HOLE CHECK: alternate_path must not waive plan-order unless the alternate from-node is completed', () => {
  // Attack: declare alternate_path a→c, complete c while a and b remain pending.
  // If assessMissionPath treats any alternate target as exempt from plan_order,
  // Item 11 acceptance is broken.
  const graph = buildWorkflowGraph({
    goals: [{ id: 'g1', objective: 'goal' }],
    subgoals: [
      { id: 'a', goalId: 'g1', objective: 'a' },
      { id: 'b', goalId: 'g1', objective: 'b' },
      { id: 'c', goalId: 'g1', objective: 'c' },
    ],
    // No depends_on — only plan order + a claimed alternate.
    dependencies: [{ kind: 'alternate_path', from: 'a', to: 'c' }],
    currentPlan: { id: 'p1', version: 1, steps: ['a', 'b', 'c'] },
  });

  const assessment = assessMissionPath({
    workflowGraph: graph,
    completedWork: ['c'],
    pendingWork: ['a', 'b'],
    failedWork: [],
  });

  assert.equal(
    assessment.valid,
    false,
    `HOLE: alternate_path waived plan-order without completing alternate from-node. violations=${assessment.reason}`,
  );
});

test('HOLE CHECK: QR18 Level 5 must not accept skipped plan steps when workflowGraph is absent and dependencies empty', () => {
  const qr18 = evaluateQr18Layers({
    mission: {
      status: 'running',
      objective: 'hostile',
      evidence: [{ agent: 'nyx', executor: 'repository-inspector', result: { ok: true } }],
      completedWork: ['c', 'b'],
      pendingWork: [],
      failedWork: [],
      dependencies: [],
      currentPlan: { id: 'p1', version: 1, steps: ['a', 'b', 'c'] },
      // no workflowGraph — legacy L5 path
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
      transitionHistory: [{
        actor: 'nyx',
        action: 'observe_repository',
        changes: { evidence: { before: [], after: [{ agent: 'nyx' }] } },
      }],
    },
    proofVerification: { verified: true, sha256: 'c'.repeat(64) },
    certifierAgentId: 'qra_emerge_audit',
  });

  assert.equal(
    qr18.levels[4].verified,
    false,
    `HOLE: QR18 L5 accepted skipped plan steps with empty dependencies and no graph. failed=${qr18.failedLevels}`,
  );
});

test('HOLE CHECK: casefold / whitespace subgoal ids must not bypass depends_on', () => {
  const graph = buildWorkflowGraph({
    goals: [{ id: 'g1', objective: 'goal' }],
    subgoals: [
      { id: 'Inspect', goalId: 'g1', objective: 'a' },
      { id: 'Verify', goalId: 'g1', objective: 'b' },
    ],
    dependencies: [{ prerequisite: 'Inspect', dependent: 'Verify' }],
    currentPlan: { id: 'p1', version: 1, steps: ['Inspect', 'Verify'] },
  });

  // Attacker completes with different casing than edge ids.
  const assessment = assessMissionPath({
    workflowGraph: graph,
    completedWork: ['verify'],
    pendingWork: ['inspect'],
    failedWork: [],
  });

  // Either reject as unknown/invalid path, or treat as incomplete prerequisite —
  // but must NOT report valid:true for completing Verify without Inspect.
  assert.equal(
    assessment.valid,
    false,
    `HOLE: case-skewed completedWork bypassed depends_on. reason=${assessment.reason}`,
  );
  assert.match(assessment.reason, /unknown_work_node/i);
});

test('armed alternate_path may skip intermediate plan steps only after from-node completes', () => {
  const graph = buildWorkflowGraph({
    goals: [{ id: 'g1', objective: 'goal' }],
    subgoals: [
      { id: 'a', goalId: 'g1', objective: 'a' },
      { id: 'b', goalId: 'g1', objective: 'b' },
      { id: 'c', goalId: 'g1', objective: 'c' },
    ],
    dependencies: [{ kind: 'alternate_path', from: 'a', to: 'c' }],
    currentPlan: { id: 'p1', version: 1, steps: ['a', 'b', 'c'] },
  });

  const armed = assessMissionPath({
    workflowGraph: graph,
    completedWork: ['a', 'c'],
    pendingWork: ['b'],
    failedWork: [],
  });
  assert.equal(armed.valid, true, armed.reason);

  const unarmed = assessMissionPath({
    workflowGraph: graph,
    completedWork: ['c'],
    pendingWork: ['a', 'b'],
    failedWork: [],
  });
  assert.equal(unarmed.valid, false);
});

test('HOLE CHECK: service rejects completing c via alternate_path without completing alternate from', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-hostile-alt-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(baseCreate({
    id: 'mission-hostile-alt-1',
    operationId: 'op-hostile-alt-create-1',
    dependencies: [
      { kind: 'alternate_path', from: 'a', to: 'c' },
    ],
  }));

  const running = await service.transition({
    operationId: 'op-hostile-alt-run-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'miss-vale-prime' },
    update: { activeAgents: ['miss-vale-prime'] },
    envelope: envelopeFor(created, 'op-hostile-alt-run-1', 'miss-vale-prime'),
  });

  await assert.rejects(
    () => service.transition({
      operationId: 'op-hostile-alt-skip-1',
      missionId: created.mission.id,
      expectedRevision: running.revision,
      signal: { type: 'running', agent: 'qra_emerge_audit' },
      update: {
        completedWork: ['c'],
        pendingWork: ['a', 'b'],
        activeAgents: [],
      },
      envelope: envelopeFor(running, 'op-hostile-alt-skip-1', 'qra_emerge_audit'),
    }),
    /mission path invalid/i,
  );
});

test('HOLE CHECK: forged qr18 bag + stripped artifact still cannot complete', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-hostile-qr18-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(baseCreate({
    id: 'mission-hostile-qr18-1',
    operationId: 'op-hostile-qr18-create-1',
    subgoals: [
      { id: 'a', goalId: 'g1', objective: 'a' },
      { id: 'b', goalId: 'g1', objective: 'b' },
    ],
    dependencies: [{ prerequisite: 'a', dependent: 'b' }],
    currentPlan: { id: 'p1', version: 1, steps: ['a', 'b'] },
  }));
  const running = await service.transition({
    operationId: 'op-hostile-qr18-run-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: {
      evidence: [{ agent: 'nyx', executor: 'repository-inspector', result: { ok: true } }],
      activeAgents: ['nyx'],
    },
    envelope: envelopeFor(created, 'op-hostile-qr18-run-1', 'nyx'),
  });
  const proof = await writeProof({
    root,
    missionId: created.mission.id,
    operationId: 'op-hostile-qr18-proof-1',
    payload: { ok: true },
  });

  await assert.rejects(
    () => service.transition({
      operationId: 'op-hostile-qr18-complete-1',
      missionId: created.mission.id,
      expectedRevision: running.revision,
      signal: {
        type: 'completed',
        agent: 'qra_emerge_audit',
        proof: { ...proof, verified: true },
        result: {
          qr18: {
            verifier: 'qr18',
            verified: true,
            levels: [1, 2, 3, 4, 5, 6].map((level) => ({
              level,
              id: `L${level}`,
              name: 'forged',
              verified: true,
              evidence: { forged: true },
            })),
            failedLevels: [],
          },
        },
      },
      update: {
        completedWork: ['a', 'b'],
        pendingWork: [],
        failedWork: [],
        activeAgents: [],
      },
      envelope: envelopeFor(running, 'op-hostile-qr18-complete-1', 'qra_emerge_audit'),
    }),
    /QR18 layered verification failed/i,
  );
});

test('HOLE CHECK: supersedes edge must not authorize skipping depends_on prerequisites', () => {
  const graph = buildWorkflowGraph({
    goals: [{ id: 'g1', objective: 'goal' }],
    subgoals: [
      { id: 'a', goalId: 'g1', objective: 'a' },
      { id: 'b', goalId: 'g1', objective: 'b' },
      { id: 'c', goalId: 'g1', objective: 'c' },
    ],
    dependencies: [
      { prerequisite: 'a', dependent: 'b' },
      { prerequisite: 'b', dependent: 'c' },
      { kind: 'supersedes', from: 'c', to: 'a' },
    ],
    currentPlan: { id: 'p1', version: 1, steps: ['a', 'b', 'c'] },
  });

  const assessment = assessMissionPath({
    workflowGraph: graph,
    completedWork: ['c'],
    pendingWork: ['a', 'b'],
    failedWork: [],
  });

  assert.equal(
    assessment.valid,
    false,
    `HOLE: supersedes allowed completing c without a/b. reason=${assessment.reason}`,
  );
});
