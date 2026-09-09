import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentRuntime } from '../../packages/agent/src/agent-runtime.js';
import { createAgentOperationEnvelope, authorizeAgentOperation } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import {
  createMissionStore,
  createMissionStoreBridge,
  loadCurrentJobPointer,
} from '../../packages/mission/src/mission-store.js';
import {
  assertOperationalAdmission,
  OPERATIONAL_LOOKBACK_FIELDS,
} from '../../packages/mission/src/current-job-pointer.js';
import { createMemoryResonanceBus } from '../../packages/resonance/src/resonance-bus.js';
import { createMissionOrchestrator } from '../../packages/orchestrator/src/mission-orchestrator.js';
import { recoverAndHealMissions } from '../../packages/recovery/src/recovery-coordinator.js';

const clock = () => '2026-09-09T04:00:00.000Z';

function createInput(id) {
  return {
    operationId: `op-create-${id}`,
    id,
    objective: 'Continue the live job without starting stupid',
    goals: [{ id: 'goal-1', objective: 'Persist current job' }],
    subgoals: [
      { id: 'inspect-repository', objective: 'Inspect', goalId: 'goal-1' },
      { id: 'run-node-tests', objective: 'Test', goalId: 'goal-1' },
      { id: 'verify-proof', objective: 'Prove', goalId: 'goal-1' },
    ],
    dependencies: [
      { prerequisite: 'inspect-repository', dependent: 'run-node-tests' },
      { prerequisite: 'run-node-tests', dependent: 'verify-proof' },
    ],
    constraints: ['no model-authored completion'],
    permissions: [
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
      { actor: 'qra_recovery_driver', actions: [
        'block_interrupted_mission',
        'create_checkpoint',
        'create_branch',
        'quarantine_branch',
        'rollback_to_checkpoint',
        'retry_from_checkpoint',
      ] },
    ],
    currentPlan: { id: 'titan-test-plan', version: 1, steps: ['inspect-repository', 'run-node-tests', 'verify-proof'] },
    environmentObservations: [{ source: 'runtime', key: 'node_version', value: '24.14.1', observedAt: clock() }],
  };
}

function passingExecutor() {
  return {
    async inspect() {
      return { package: { name: 'athere-titan', version: '0.1.0' }, sourceFilesOnDisk: 12, testFilesOnDisk: 60 };
    },
    async runTests() {
      return {
        command: 'node --test', exitCode: 0, tests: 4, passed: 4, failed: 0, skipped: 0,
        stdout: 'ok', stderr: '',
      };
    },
  };
}

test('advisory envelopes cannot admit operational tools', () => {
  assert.throws(
    () => assertOperationalAdmission({ missionId: 'advisory-abc', stateVersion: 0 }),
    /advisory envelope cannot admit operational tools/,
  );
  const runtime = createAgentRuntime({
    complete: async () => ({ content: 'should not run' }),
  });
  assert.rejects(
    () => runtime.respond({
      profile: 'owner',
      envelope: {
        mission_id: 'advisory-tools',
        task_id: 'task-1',
        operation_id: 'advisory-operation-1',
        agent_id: 'agent-vale',
        capability_id: 'ollama-chat',
        state_version: 0,
        objective: 'do work',
        allowed_actions: ['respond'],
        required_inputs: [],
        evidence_requirements: ['x'],
        timeout: 1000,
        resource_budget: { max_agent_calls: 1, max_tool_calls: 2 },
        expected_output_schema: { type: 'object', required: ['content'] },
        completion_conditions: ['x'],
        error_state: null,
        provenance: { requested_by: 'titan-advisory-api', created_at: clock() },
      },
    }),
    /does not permit respond|advisory envelope cannot admit operational tools|duplicate/i,
  );
});

test('authorizeAgentOperation rejects advisory mission ids and revision 0', () => {
  assert.throws(
    () => createAgentOperationEnvelope({
      record: { mission: { id: 'advisory-x' }, revision: 0 },
      operationId: 'op-1',
      agentId: 'nyx',
      objective: 'should fail',
      createdAt: clock(),
    }),
    /advisory envelope cannot admit operational tools/,
  );
  const envelope = createAgentOperationEnvelope({
    record: { mission: { id: 'mission-live-x' }, revision: 0 },
    operationId: 'op-1',
    agentId: 'nyx',
    objective: 'should fail at authorize',
    createdAt: clock(),
  });
  assert.throws(
    () => authorizeAgentOperation({
      envelope,
      mission: { id: 'mission-live-x', permissions: [{ actor: 'nyx', actions: ['observe_repository'] }] },
      expectedRevision: 0,
      operationId: 'op-1',
    }),
    /advisory envelope cannot admit operational tools|state_version/,
  );
});

test('filesystem pointer CAS: one current job, stale writer fail-closed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-pointer-fs-'));
  const store = createMissionStore();
  const first = await store.saveCurrentJobPointer({
    root,
    pointer: { jobId: 'mission-live-1', actor: 'titan', missionRevision: 1 },
    expectedRevision: 0,
  });
  assert.equal(first.revision, 1);
  assert.equal(first.pointer.jobId, 'mission-live-1');
  await assert.rejects(
    () => store.saveCurrentJobPointer({
      root,
      pointer: { jobId: 'mission-split', actor: 'titan', missionRevision: 1 },
      expectedRevision: 0,
    }),
    /revision conflict/,
  );
  const loaded = await store.loadCurrentJobPointer({ root });
  assert.equal(loaded.pointer.jobId, 'mission-live-1');
  const second = await store.saveCurrentJobPointer({
    root,
    pointer: { jobId: 'mission-live-1', actor: 'titan', missionRevision: 2 },
    expectedRevision: 1,
  });
  assert.equal(second.revision, 2);
  assert.equal((await loadCurrentJobPointer({ root })).pointer.jobId, 'mission-live-1');
});

test('admitWork lookback-before-tools and fail closed without pointer or create', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-admit-'));
  const service = createMissionStateService({ root, clock });
  await assert.rejects(
    () => service.admitWork({}),
    /no current job pointer; create a mission before tools/,
  );
  let created = false;
  const admitted = await service.admitWork({
    create: async () => {
      created = true;
      return service.create(createInput('mission-admit-1'));
    },
  });
  assert.equal(created, true);
  assert.equal(admitted.created, true);
  assert.equal(admitted.toolsAdmitted, true);
  assert.equal(admitted.stateVersion, 1);
  assert.equal(admitted.lookback.missionId, 'mission-admit-1');
  assert.equal(admitted.lookback.stateVersion, 1);
  for (const field of OPERATIONAL_LOOKBACK_FIELDS) {
    assert.equal(Object.hasOwn(admitted.lookback, field), true, field);
  }
  const again = await service.admitWork({});
  assert.equal(again.created, false);
  assert.equal(again.record.mission.id, 'mission-admit-1');
  assert.equal(again.stateVersion, admitted.stateVersion);
});

test('unwired pointer store fails closed (product amnesia)', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-unwired-'));
  const shared = new Map();
  const store = createMissionStoreBridge({
    async loadMission({ missionId }) {
      const record = shared.get(missionId);
      if (!record) throw new Error('mission snapshot not found');
      return record;
    },
    async saveMission({ mission, expectedRevision }) {
      const current = shared.get(mission.id);
      const currentRevision = current?.revision ?? 0;
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        throw new Error(`revision conflict: expected ${expectedRevision}, found ${currentRevision}`);
      }
      const record = Object.freeze({ revision: currentRevision + 1, mission });
      shared.set(mission.id, record);
      return record;
    },
  });
  const service = createMissionStateService({ root, clock, store });
  await assert.rejects(() => service.loadCurrentJobPointer(), /pointer store is not wired/);
});

test('writeTieIn checkpoint includes required stop fields', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-tiein-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput('mission-tiein-1'));
  const running = await service.transition({
    operationId: 'op-run-tiein',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'inspection' },
    update: {
      evidence: [{ agent: 'nyx', executor: 'repository-inspector', result: { sourceFilesOnDisk: 1 } }],
      activeAgents: ['nyx'],
    },
    envelope: createAgentOperationEnvelope({
      record: created,
      operationId: 'op-run-tiein',
      agentId: 'nyx',
      objective: 'inspect',
      createdAt: clock(),
    }),
  });
  const stopped = await service.writeTieIn({
    missionId: running.mission.id,
    expectedRevision: running.revision,
    operationId: `${running.mission.id}-stop-r${running.revision}`,
    reason: 'crash',
    envelope: createAgentOperationEnvelope({
      record: running,
      operationId: `${running.mission.id}-stop-r${running.revision}-checkpoint`,
      agentId: 'qra_recovery_driver',
      action: 'create_checkpoint',
      objective: 'tie-in before stop',
      createdAt: clock(),
    }),
  });
  const tieIn = stopped.tieIn;
  assert.equal(tieIn.jobId, running.mission.id);
  assert.equal(tieIn.revision, running.revision);
  assert.equal(tieIn.statusAfterStop, 'blocked');
  assert.ok(tieIn.workPartitions);
  assert.equal(tieIn.actor, 'qra_recovery_driver');
  assert.ok(tieIn.operationId);
  assert.equal(tieIn.expectedRevision, running.revision);
  assert.ok(Array.isArray(tieIn.evidenceRefs));
  const last = stopped.mission.checkpoints.at(-1);
  assert.equal(last.tieIn.jobId, running.mission.id);
});

test('new orchestrator process without mission id continues the live job', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-continue-job-'));
  let inspectCalls = 0;
  const first = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    bus: createMemoryResonanceBus(),
    executor: {
      async inspect() {
        inspectCalls += 1;
        return { package: { name: 'athere-titan', version: '0.1.0' }, sourceFilesOnDisk: 2, testFilesOnDisk: 2 };
      },
      async runTests() {
        throw new Error('simulated crash mid-slice');
      },
    },
    clock,
    idFactory: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  const crashed = await first.execute({ profile: 'owner', text: 'test all of Titan' });
  assert.ok(crashed.mission.status === 'blocked' || crashed.status === 'blocked' || crashed.healed === true);
  const jobId = crashed.mission.id;
  const pointer = await loadCurrentJobPointer({ root });
  assert.equal(pointer.pointer.jobId, jobId);

  const inspectBeforeResume = inspectCalls;
  const second = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    bus: createMemoryResonanceBus(),
    executor: {
      async inspect() {
        inspectCalls += 1;
        throw new Error('inspect must not rerun when continuing live job');
      },
      async runTests() {
        return {
          command: 'node --test', exitCode: 0, tests: 4, passed: 4, failed: 0, skipped: 0,
          stdout: 'ok', stderr: '',
        };
      },
    },
    clock,
  });
  const continued = await second.execute({ profile: 'owner', text: 'test all of Titan' });
  assert.equal(continued.mission.id, jobId);
  assert.equal(inspectCalls, inspectBeforeResume);
  assert.equal(continued.mission.status, 'completed');
});

test('boot recoverAndHeal keeps the current-job pointer on the live job', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-boot-pointer-'));
  const orchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    bus: createMemoryResonanceBus(),
    executor: passingExecutor(),
    clock,
    idFactory: () => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  });
  const running = await orchestrator.execute({ profile: 'owner', text: 'test all of Titan' });
  assert.equal(running.mission.status, 'completed');
  const pointer = await loadCurrentJobPointer({ root });
  assert.equal(pointer.pointer.jobId, running.mission.id);
  const recovery = await recoverAndHealMissions({ root });
  const after = await loadCurrentJobPointer({ root });
  assert.equal(after.pointer.jobId, running.mission.id);
  assert.ok(recovery);
});

test('Item 15: admit lookback is select() current state, not retrieval override', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-item15-lookback-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput('mission-item15-1'));
  await service.setCurrentJobPointer({
    jobId: created.mission.id,
    missionRevision: created.revision,
    expectedRevision: 0,
    actor: 'titan',
    operationId: 'op-pointer-item15',
  });
  const admitted = await service.admitWork({});
  assert.equal(admitted.lookback.objective, created.mission.objective);
  assert.equal(admitted.lookback.stateVersion, created.revision);
  assert.equal(admitted.lookback.status, 'accepted');
  const retrieved = await service.retrieveMemory({
    missionId: created.mission.id,
    reader: 'mission-state-service',
    query: { text: created.mission.objective },
  });
  assert.notEqual(retrieved.selected?.mayOverrideCurrent, true);
});

test('malformed inspect writes crash tie-in then escalates; boot heal keeps pointer and stays blocked', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-crash-pointer-'));
  const orchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    bus: createMemoryResonanceBus(),
    clock,
    idFactory: () => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    executor: {
      async inspect() {
        return { package: 'not-package-metadata', sourceFilesOnDisk: -1, testFilesOnDisk: 'many' };
      },
      async runTests() {
        throw new Error('must not run');
      },
    },
  });
  const stopped = await orchestrator.execute({ profile: 'owner', text: 'test all of Titan' });
  assert.equal(stopped.mission.status, 'blocked');
  assert.equal(stopped.executive?.nextAction, 'escalate_human');
  const crashTieIn = (stopped.mission.checkpoints ?? []).some((entry) => entry.label === 'tie-in-crash' && entry.tieIn?.jobId === stopped.mission.id);
  assert.equal(crashTieIn, true);
  const pointer = await loadCurrentJobPointer({ root });
  assert.equal(pointer.pointer.jobId, stopped.mission.id);
  const recovery = await recoverAndHealMissions({ root, clock });
  const afterHeal = await loadCurrentJobPointer({ root });
  assert.equal(afterHeal.pointer.jobId, stopped.mission.id);
  const healedIds = recovery.healed ?? [];
  assert.equal(healedIds.includes(stopped.mission.id), false);
  const second = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    bus: createMemoryResonanceBus(),
    clock,
    executor: {
      async inspect() { throw new Error('must not start stupid after blocked crash'); },
      async runTests() { throw new Error('must not run'); },
    },
  });
  const continued = await second.execute({ profile: 'owner', text: 'test all of Titan' });
  assert.equal(continued.mission.id, stopped.mission.id);
  assert.equal(continued.status, 'blocked');
  assert.equal(continued.executive?.nextAction, 'escalate_human');
});
