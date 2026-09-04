import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

function clock() {
  return '2026-09-04T05:00:00.000Z';
}

function createInput(overrides = {}) {
  return {
    operationId: 'op-path-create-1',
    id: 'mission-path-1',
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

test('mission create persists a workflow graph and rejects out-of-path completedWork', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-workflow-path-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput());
  assert.equal(created.mission.workflowGraph.version, 1);
  assert.ok(created.mission.workflowGraph.nodes.some((node) => node.kind === 'verification_gate'));

  const running = await service.transition({
    operationId: 'op-path-running-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'miss-vale-prime' },
    update: { activeAgents: ['miss-vale-prime'] },
    envelope: envelopeFor(created, 'op-path-running-1', 'miss-vale-prime'),
  });

  // Auditor tries to certify verify before inspect — illegal path even if role-legal.
  await assert.rejects(
    () => service.transition({
      operationId: 'op-path-skip-1',
      missionId: created.mission.id,
      expectedRevision: running.revision,
      signal: { type: 'running', agent: 'qra_emerge_audit', detail: 'skip ahead' },
      update: {
        completedWork: ['verify'],
        pendingWork: ['inspect'],
        activeAgents: [],
      },
      envelope: envelopeFor(running, 'op-path-skip-1', 'qra_emerge_audit'),
    }),
    /mission path invalid/i,
  );

  const after = await service.get({ missionId: created.mission.id });
  assert.deepEqual(after.mission.completedWork, []);
  assert.deepEqual(after.mission.pendingWork, ['inspect', 'verify']);
});

test('in-order completedWork remains on a valid mission path', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-workflow-ok-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({ id: 'mission-path-ok-1', operationId: 'op-path-ok-create-1' }));
  const running = await service.transition({
    operationId: 'op-path-ok-running-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: {
      evidence: [{ agent: 'nyx', executor: 'repository-inspector', result: { ok: true } }],
      activeAgents: ['nyx'],
    },
    envelope: envelopeFor(created, 'op-path-ok-running-1', 'nyx'),
  });
  const certified = await service.transition({
    operationId: 'op-path-ok-cert-1',
    missionId: created.mission.id,
    expectedRevision: running.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit' },
    update: {
      completedWork: ['inspect'],
      pendingWork: ['verify'],
      activeAgents: [],
    },
    envelope: envelopeFor(running, 'op-path-ok-cert-1', 'qra_emerge_audit'),
  });
  assert.deepEqual(certified.mission.completedWork, ['inspect']);
  assert.deepEqual(certified.mission.pendingWork, ['verify']);
});

test('workflowGraph cannot be mutated after create', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-workflow-immut-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({ id: 'mission-path-immut-1', operationId: 'op-path-immut-create-1' }));
  await assert.rejects(
    () => service.transition({
      operationId: 'op-path-immut-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'miss-vale-prime' },
      update: { workflowGraph: { version: 99, nodes: [], edges: [] }, activeAgents: ['miss-vale-prime'] },
      envelope: envelopeFor(created, 'op-path-immut-1', 'miss-vale-prime'),
    }),
    /workflowGraph is immutable/i,
  );
});
