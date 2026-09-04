import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { createMissionOrchestrator } from '../../packages/orchestrator/src/mission-orchestrator.js';
import { createMemoryResonanceBus } from '../../packages/resonance/src/resonance-bus.js';

const clock = () => '2026-09-03T20:00:00.000Z';

function createInput(overrides = {}) {
  return {
    operationId: 'op-mea-create-1',
    id: 'mission-mea-1',
    objective: 'Prove Manager / Executor / Auditor separation',
    goals: [{ id: 'goal-1', objective: 'Separate success certification from execution' }],
    subgoals: [
      { id: 'inspect', objective: 'Inspect repository', goalId: 'goal-1' },
      { id: 'verify', objective: 'Verify persistence', goalId: 'goal-1' },
    ],
    dependencies: [{ prerequisite: 'inspect', dependent: 'verify' }],
    constraints: ['executor cannot certify own success'],
    permissions: [
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'rune', actions: ['execute_node_tests'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
      { actor: 'qra_recovery_driver', actions: ['block_interrupted_mission'] },
    ],
    currentPlan: { id: 'plan-mea-1', version: 1, steps: ['inspect', 'verify'] },
    environmentObservations: [{ source: 'runtime', key: 'mea', value: true, observedAt: '2026-09-03T19:59:00.000Z' }],
    ...overrides,
  };
}

function envelopeFor(record, operationId, agentId, objective = 'mea transition') {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    objective,
    createdAt: clock(),
  });
}

test('executor cannot advance completedWork through the mission state service', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-mea-executor-completed-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput());

  await assert.rejects(
    service.transition({
      operationId: 'op-mea-executor-completed-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx', detail: 'self-certifying inspection' },
      update: {
        completedWork: ['inspect'],
        pendingWork: ['verify'],
        evidence: [{ agent: 'nyx', executor: 'repository-inspector', result: { ok: true } }],
        activeAgents: ['nyx'],
      },
      envelope: envelopeFor(created, 'op-mea-executor-completed-1', 'nyx'),
    }),
    /only auditor may certify subgoal success/,
  );
  assert.deepEqual((await service.get({ missionId: created.mission.id })).mission.completedWork, []);
});

test('manager cannot advance completedWork or emit completed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-mea-manager-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({ operationId: 'op-mea-manager-create-1', id: 'mission-mea-manager-1' }));

  await assert.rejects(
    service.transition({
      operationId: 'op-mea-manager-completed-work-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'miss-vale-prime', detail: 'manager self-certifies' },
      update: { completedWork: ['inspect'], pendingWork: ['verify'] },
      envelope: envelopeFor(created, 'op-mea-manager-completed-work-1', 'miss-vale-prime'),
    }),
    /only auditor may certify subgoal success/,
  );

  await assert.rejects(
    service.transition({
      operationId: 'op-mea-manager-completed-signal-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: {
        type: 'completed',
        agent: 'miss-vale-prime',
        proof: { verified: true, path: 'proofs/forged.json', sha256: 'a'.repeat(64), operationId: 'forged' },
      },
      envelope: envelopeFor(created, 'op-mea-manager-completed-signal-1', 'miss-vale-prime'),
    }),
    /cannot (perform completed transition|emit completed)/i,
  );
});

test('executor cannot emit completed; only auditor may advance completedWork after independent evidence', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-mea-auditor-gate-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({ operationId: 'op-mea-audit-create-1', id: 'mission-mea-audit-1' }));

  await assert.rejects(
    service.transition({
      operationId: 'op-mea-executor-completed-signal-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: {
        type: 'completed',
        agent: 'nyx',
        proof: { verified: true, path: 'proofs/forged.json', sha256: 'a'.repeat(64), operationId: 'forged' },
      },
      envelope: envelopeFor(created, 'op-mea-executor-completed-signal-1', 'nyx'),
    }),
    /cannot (perform completed transition|emit completed)/i,
  );

  const executed = await service.transition({
    operationId: 'op-mea-executor-evidence-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'inspection evidence only' },
    update: {
      evidence: [{ agent: 'nyx', executor: 'repository-inspector', result: { sourceFilesOnDisk: 3 } }],
      activeAgents: ['nyx'],
    },
    envelope: envelopeFor(created, 'op-mea-executor-evidence-1', 'nyx'),
  });
  assert.deepEqual(executed.mission.completedWork, []);

  const certified = await service.transition({
    operationId: 'op-mea-auditor-completed-work-1',
    missionId: created.mission.id,
    expectedRevision: executed.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit', detail: 'auditor certifies inspection' },
    update: {
      completedWork: ['inspect'],
      pendingWork: ['verify'],
      activeAgents: [],
    },
    envelope: envelopeFor(executed, 'op-mea-auditor-completed-work-1', 'qra_emerge_audit'),
  });
  assert.deepEqual(certified.mission.completedWork, ['inspect']);
  assert.deepEqual(certified.mission.pendingWork, ['verify']);
});

test('auditor cannot perform executor actions through authorization', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-mea-auditor-action-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({ operationId: 'op-mea-auditor-action-create-1', id: 'mission-mea-auditor-action-1' }));

  await assert.rejects(
    service.transition({
      operationId: 'op-mea-auditor-observe-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'qra_emerge_audit', detail: 'auditor tries to inspect' },
      update: { activeAgents: ['qra_emerge_audit'] },
      envelope: {
        ...envelopeFor(created, 'op-mea-auditor-observe-1', 'qra_emerge_audit'),
        allowed_actions: ['observe_repository'],
        capability_id: 'repository-inspector',
      },
    }),
    /cannot (perform|exclusively permit|emit running|executor action)|not bound to capability/i,
  );
});

/**
 * Adapted from a content-scrape case (NYX planting the auditor's name inside evidence)
 * to the structural requirement it was standing in for: the auditor must be the recorded
 * `actor` of a real performance transition before independence bites. Evidence content is
 * intentionally not an identity source, so the planted-name variant now proceeds — the
 * mission is still MEA-correct there, because NYX performed and the auditor certified.
 */
test('auditor cannot certify success for work it also performed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-mea-self-certify-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({ operationId: 'op-mea-self-create-1', id: 'mission-mea-self-1' }));
  const performed = await service.transition({
    operationId: 'op-mea-auditor-performs-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit', detail: 'auditor records work evidence itself' },
    update: {
      evidence: [{ id: 'evidence-inspect', kind: 'repository_observation' }],
      activeAgents: [],
    },
    envelope: envelopeFor(created, 'op-mea-auditor-performs-1', 'qra_emerge_audit'),
  });
  assert.equal(performed.mission.transitionHistory.at(-1).actor, 'qra_emerge_audit');

  await assert.rejects(
    service.transition({
      operationId: 'op-mea-self-certify-1',
      missionId: created.mission.id,
      expectedRevision: performed.revision,
      signal: { type: 'running', agent: 'qra_emerge_audit', detail: 'self-certify its own recorded work' },
      update: { completedWork: ['inspect'], pendingWork: ['verify'], activeAgents: [] },
      envelope: envelopeFor(performed, 'op-mea-self-certify-1', 'qra_emerge_audit'),
    }),
    /cannot certify success for work it also performed/,
  );
  assert.deepEqual((await service.get({ missionId: created.mission.id })).mission.completedWork, []);
});

test('orchestrator happy path completes with auditor-gated completedWork only', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-mea-orchestrator-'));
  const orchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    bus: createMemoryResonanceBus(),
    clock: (() => {
      let index = 0;
      return () => `2026-09-03T21:00:0${index++}.000Z`;
    })(),
    idFactory: () => 'mea-orchestrator-1111',
    executor: {
      async inspect() {
        return { package: { name: 'athere-titan', version: '0.1.0' }, sourceFilesOnDisk: 12, testFilesOnDisk: 60 };
      },
      async runTests() {
        return {
          command: 'node --test', exitCode: 0, tests: 60, passed: 60, failed: 0, skipped: 0,
          stdout: 'ok', stderr: '',
        };
      },
    },
  });

  const result = await orchestrator.execute({ profile: 'owner', text: 'test all of Titan' });
  assert.equal(result.mission.status, 'completed');
  assert.deepEqual(result.mission.completedWork, ['inspect-repository', 'run-node-tests', 'verify-proof']);

  const history = result.mission.transitionHistory;
  const nyxTransition = history.find(({ actor, action }) => actor === 'nyx' && action === 'observe_repository');
  const runeTransition = history.find(({ actor, action }) => actor === 'rune' && action === 'execute_node_tests');
  const auditorTransition = history.find(({ actor, action }) => actor === 'qra_emerge_audit' && action === 'verify_proof');

  assert.equal(Object.hasOwn(nyxTransition.input.update, 'completedWork'), false);
  assert.equal(Object.hasOwn(runeTransition.input.update, 'completedWork'), false);
  assert.deepEqual(auditorTransition.input.update.completedWork, ['inspect-repository', 'run-node-tests', 'verify-proof']);
  assert.deepEqual(
    history.filter(({ input }) => Object.hasOwn(input?.update ?? {}, 'completedWork')).map(({ actor }) => actor),
    ['qra_emerge_audit'],
  );
});
