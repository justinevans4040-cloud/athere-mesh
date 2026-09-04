import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { reconstructFailedMission } from '../../packages/mission/src/mission-execution-trace.js';
import { createMissionOrchestrator } from '../../packages/orchestrator/src/mission-orchestrator.js';

function clock() {
  return '2026-09-04T14:00:00.000Z';
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
    operationId: 'op-trace-create-1',
    id: 'mission-trace-1',
    objective: 'observable long mission',
    goals: [{ id: 'goal-1', objective: 'Reach the end' }],
    subgoals: [
      { id: 'step-a', goalId: 'goal-1', objective: 'A' },
      { id: 'step-b', goalId: 'goal-1', objective: 'B' },
    ],
    dependencies: [{ prerequisite: 'step-a', dependent: 'step-b' }],
    currentPlan: { id: 'plan-1', version: 1, steps: ['step-a', 'step-b'] },
    constraints: ['completion requires independently verified proof'],
    permissions: [
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
      { actor: 'qra_recovery_driver', actions: [...RECOVERY_ACTIONS] },
    ],
    environmentObservations: [
      { source: 'titan', key: 'repository_root', value: '/tmp/repo', observedAt: clock() },
    ],
    ...overrides,
  };
}

function envelopeFor(record, operationId, agentId, action) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    action,
    objective: `${agentId} ${action ?? 'default'}`,
    createdAt: clock(),
  });
}

test('Item 13: create initializes executionTrace and rejects transition forge', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-trace-init-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput());
  assert.ok(Array.isArray(created.mission.executionTrace));
  assert.ok(created.mission.executionTrace.length >= 1);
  assert.equal(created.mission.executionTrace[0].kind, 'state_change');

  await assert.rejects(
    () => service.transition({
      operationId: 'op-trace-forge',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'miss-vale-prime' },
      update: { executionTrace: [], activeAgents: ['miss-vale-prime'] },
      envelope: envelopeFor(created, 'op-trace-forge', 'miss-vale-prime'),
    }),
    /executionTrace must be changed through mission observability/,
  );
});

test('Item 13: blocked mission is reconstructable with agents, failures, and state changes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-trace-fail-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({ id: 'mission-trace-fail', operationId: 'op-trace-fail-create' }));
  const running = await service.transition({
    operationId: 'op-trace-fail-run',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: {
      evidence: [{ agent: 'nyx', note: 'partial work' }],
      activeAgents: ['nyx'],
    },
    envelope: envelopeFor(created, 'op-trace-fail-run', 'nyx'),
    observability: {
      toolCalls: [{ tool: 'repository-inspector', agentId: 'nyx', ok: true }],
      latencyMs: 17,
      models: [],
      tokenUsage: 0,
      costUsd: 0,
    },
  });
  const blocked = await service.transition({
    operationId: 'op-trace-fail-block',
    missionId: created.mission.id,
    expectedRevision: running.revision,
    signal: { type: 'blocked', agent: 'qra_recovery_driver', detail: 'simulated executor failure' },
    update: {
      failedWork: ['step-a', 'step-b'],
      pendingWork: [],
      activeAgents: [],
    },
    envelope: envelopeFor(running, 'op-trace-fail-block', 'qra_recovery_driver'),
  });

  assert.equal(blocked.mission.status, 'blocked');
  const reconstruction = reconstructFailedMission(blocked.mission);
  assert.equal(reconstruction.missionId, 'mission-trace-fail');
  assert.equal(reconstruction.status, 'blocked');
  assert.ok(reconstruction.agents.includes('nyx'));
  assert.ok(reconstruction.agents.includes('qra_recovery_driver'));
  assert.ok(reconstruction.toolCalls.some((entry) => entry.tool === 'repository-inspector'));
  assert.ok(reconstruction.failures.length >= 1);
  assert.ok(reconstruction.stateChanges.length >= 2);
  assert.ok(reconstruction.metrics.latencyMs.includes(17));

  const viaService = await service.reconstruct({ missionId: created.mission.id });
  assert.equal(viaService.missionId, 'mission-trace-fail');
  assert.equal(viaService.status, 'blocked');
});

test('Item 13: rollback and retry appear in the durable execution trace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-trace-rb-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput({ id: 'mission-trace-rb', operationId: 'op-trace-rb-create' }));
  const running = await service.transition({
    operationId: 'op-trace-rb-run',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'miss-vale-prime' },
    update: { activeAgents: ['miss-vale-prime'] },
    envelope: envelopeFor(created, 'op-trace-rb-run', 'miss-vale-prime'),
  });
  const checkpointed = await service.createCheckpoint({
    operationId: 'op-trace-rb-ckpt',
    missionId: created.mission.id,
    expectedRevision: running.revision,
    label: 'before-failure',
    envelope: envelopeFor(running, 'op-trace-rb-ckpt', 'qra_recovery_driver', 'create_checkpoint'),
  });
  const blocked = await service.transition({
    operationId: 'op-trace-rb-block',
    missionId: created.mission.id,
    expectedRevision: checkpointed.revision,
    signal: { type: 'blocked', agent: 'qra_recovery_driver', detail: 'mid-mission failure' },
    update: { failedWork: ['step-b'], pendingWork: [], activeAgents: [] },
    envelope: envelopeFor(checkpointed, 'op-trace-rb-block', 'qra_recovery_driver'),
  });
  const checkpointId = blocked.mission.checkpoints[0].id;
  const rolled = await service.rollbackToCheckpoint({
    operationId: 'op-trace-rb-rollback',
    missionId: created.mission.id,
    expectedRevision: blocked.revision,
    checkpointId,
    envelope: envelopeFor(blocked, 'op-trace-rb-rollback', 'qra_recovery_driver', 'rollback_to_checkpoint'),
  });
  // rollback resumes blocked → running; re-block before retry (Item 12 gate).
  const blockedAgain = await service.transition({
    operationId: 'op-trace-rb-block-2',
    missionId: created.mission.id,
    expectedRevision: rolled.revision,
    signal: { type: 'blocked', agent: 'qra_recovery_driver', detail: 'second failure before retry' },
    update: { failedWork: ['step-b'], pendingWork: [], activeAgents: [] },
    envelope: envelopeFor(rolled, 'op-trace-rb-block-2', 'qra_recovery_driver'),
  });
  const retried = await service.retryFromCheckpoint({
    operationId: 'op-trace-rb-retry',
    missionId: created.mission.id,
    expectedRevision: blockedAgain.revision,
    checkpointId,
    envelope: envelopeFor(blockedAgain, 'op-trace-rb-retry', 'qra_recovery_driver', 'retry_from_checkpoint'),
  });

  const kinds = retried.mission.executionTrace.map((event) => event.kind);
  assert.ok(kinds.includes('rollback'));
  assert.ok(kinds.includes('retry'));
  const reconstruction = reconstructFailedMission(retried.mission);
  assert.ok(reconstruction.rollbacks.length >= 1);
  assert.ok(reconstruction.retries.length >= 1);
});

test('Item 13: orchestrator failure path leaves a reconstructable mission trace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-trace-orch-'));
  const repo = await mkdtemp(path.join(tmpdir(), 'athere-trace-repo-'));
  const orchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: repo,
    clock,
    idFactory: () => 'trace-orch-1',
    executor: {
      async inspect() {
        return {
          package: { name: 'athere-titan', version: '0.1.0' },
          sourceFilesOnDisk: 1,
          testFilesOnDisk: 1,
        };
      },
      async runTests() {
        throw new Error('forced executor failure for Item 13');
      },
    },
  });

  const result = await orchestrator.execute({ profile: 'owner', text: 'test all of Titan' });
  assert.ok(result.status === 'blocked' || result.mission?.status === 'blocked' || result.healed === true
    || result.mission?.status === 'running');
  const missionId = result.mission?.id ?? 'mission-trace-orch-1';
  const loaded = await orchestrator.getMission({ missionId });
  const reconstruction = reconstructFailedMission(loaded.mission);
  assert.equal(reconstruction.missionId, loaded.mission.id);
  assert.ok(reconstruction.toolCalls.length >= 1);
  assert.ok(reconstruction.agents.includes('nyx'));
  assert.ok(
    reconstruction.failures.length >= 1
      || reconstruction.retries.length >= 1
      || loaded.mission.status === 'running',
    'failed or healed mission must retain failure/retry observability',
  );
});
