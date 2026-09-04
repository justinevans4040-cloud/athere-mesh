import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMemoryResonanceBus } from '../../packages/resonance/src/resonance-bus.js';
import { createMissionOrchestrator } from '../../packages/orchestrator/src/mission-orchestrator.js';
import { createMission } from '../../packages/contracts/src/mission.js';
import { saveMission } from '../../packages/mission/src/mission-store.js';

function clock() {
  let index = 0;
  return () => `2026-08-23T12:00:0${index++}.000Z`;
}

function passingExecutor() {
  return {
    async inspect() {
      return { package: { name: 'athere-titan', version: '0.1.0' }, sourceFilesOnDisk: 12, testFilesOnDisk: 60 };
    },
    async runTests() {
      return {
        command: 'node --test', exitCode: 0, tests: 60, passed: 60, failed: 0, skipped: 0,
        stdout: 'ℹ tests 60\nℹ pass 60\nℹ fail 0\nℹ skipped 0', stderr: '',
      };
    },
  };
}

test('restart retrieval preserves NYX and RUNE evidence plus proof-bound validated totals', async () => {
  const root = await workspace();
  const executor = passingExecutor();
  const orchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    bus: createMemoryResonanceBus(),
    executor,
    clock: clock(),
    idFactory: () => 'restart-evidence-1111',
  });

  const immediate = await orchestrator.execute({ profile: 'owner', text: 'test all of Titan' });
  const fresh = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    bus: createMemoryResonanceBus(),
    executor,
  });
  const stored = await fresh.getMission({ missionId: immediate.mission.id });

  assert.deepEqual(stored.mission.signals.map(({ agent }) => agent), [
    'titan', 'miss-vale-prime', 'nyx', 'rune', 'qra_emerge_audit',
  ]);
  assert.deepEqual(stored.mission.signals[2].evidence, {
    executor: 'repository-inspector',
    result: { package: { name: 'athere-titan', version: '0.1.0' }, sourceFilesOnDisk: 12, testFilesOnDisk: 60 },
  });
  assert.deepEqual(stored.mission.signals[3].evidence, {
    executor: 'node-test-runner',
    result: { command: 'node --test', exitCode: 0, tests: 60, passed: 60, failed: 0, skipped: 0 },
  });
  assert.deepEqual(stored.mission.result.tests, { tests: 60, passed: 60, failed: 0, skipped: 0 });
  assert.deepEqual(stored.mission.result.agentEvidence, [
    { agent: 'nyx', executor: 'repository-inspector', result: stored.mission.signals[2].evidence.result },
    { agent: 'rune', executor: 'node-test-runner', result: stored.mission.signals[3].evidence.result },
  ]);
  assert.equal(stored.mission.result.proofSha256, stored.mission.proof.sha256);
  assert.equal(stored.mission.artifactReferences.length, 1);
  assert.equal(stored.mission.artifactReferences[0].id, 'mission-proof');
  assert.match(stored.mission.artifactReferences[0].artifactHash, /^[a-f0-9]{64}$/);
  assert.match(stored.mission.artifactReferences[0].proofHash, /^[a-f0-9]{64}$/);
  // Item 6: artifact lineage keeps producer action and verifier decision.
  assert.equal(stored.mission.artifactReferences[0].agent, 'qra_emerge_audit');
  assert.equal(stored.mission.artifactReferences[0].action, 'verified_mission_proof');
  assert.equal(stored.mission.artifactReferences[0].missionStateVersion, 4);
  assert.deepEqual(stored.mission.artifactReferences[0].verifierResult, {
    verifier: 'qra_emerge_audit', verified: true, proofSha256: stored.mission.proof.sha256,
  });
  assert.deepEqual(immediate.tests, stored.mission.result.tests);
});

test('orchestrator dispatches NYX and RUNE through complete state-bound agent envelopes', async () => {
  const root = await workspace();
  const received = [];
  const executor = {
    async inspect({ envelope }) {
      received.push(envelope);
      return { package: { name: 'athere-titan', version: '0.1.0' }, sourceFilesOnDisk: 12, testFilesOnDisk: 60 };
    },
    async runTests({ envelope }) {
      received.push(envelope);
      return {
        command: 'node --test', exitCode: 0, tests: 60, passed: 60, failed: 0, skipped: 0,
        stdout: 'complete', stderr: '',
      };
    },
  };
  const orchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    executor,
    clock: clock(),
    idFactory: () => 'envelope-dispatch-1111',
  });

  const result = await orchestrator.execute({ profile: 'owner', text: 'test all of Titan' });

  assert.equal(result.mission.status, 'completed');
  assert.deepEqual(received.map((envelope) => ({
    mission_id: envelope.mission_id,
    task_id: envelope.task_id,
    operation_id: envelope.operation_id,
    agent_id: envelope.agent_id,
    capability_id: envelope.capability_id,
    state_version: envelope.state_version,
    allowed_actions: envelope.allowed_actions,
    required_input_name: envelope.required_inputs[0],
    input_binding_valid: /^node_execution_input_sha256:[a-f0-9]{64}$/.test(envelope.required_inputs[1]),
    timeout: envelope.timeout,
    error_state: envelope.error_state,
    requested_by: envelope.provenance.requested_by,
  })), [
    {
      mission_id: 'mission-envelope-dispatch-1111',
      task_id: 'inspect-repository',
      operation_id: 'mission-envelope-dispatch-1111-inspect-execution',
      agent_id: 'nyx',
      capability_id: 'repository-inspector',
      state_version: 2,
      allowed_actions: ['observe_repository'],
      required_input_name: 'repository_root',
      input_binding_valid: true,
      timeout: 30_000,
      error_state: null,
      requested_by: 'miss-vale-prime',
    },
    {
      mission_id: 'mission-envelope-dispatch-1111',
      task_id: 'run-node-tests',
      operation_id: 'mission-envelope-dispatch-1111-test-execution',
      agent_id: 'rune',
      capability_id: 'node-test-runner',
      state_version: 3,
      allowed_actions: ['execute_node_tests'],
      required_input_name: 'repository_root',
      input_binding_valid: true,
      timeout: 300_000,
      error_state: null,
      requested_by: 'miss-vale-prime',
    },
  ]);
  assert.equal(received.every(Object.isFrozen), true);
});

test('orchestrator rejects executor output that violates the declared operation schema', async () => {
  const malformedInspectionRoot = await workspace();
  const malformedInspection = createMissionOrchestrator({
    root: malformedInspectionRoot,
    repositoryRoot: malformedInspectionRoot,
    clock: clock(),
    idFactory: () => 'malformed-inspection-1111',
    executor: {
      async inspect() {
        return { package: 'not-package-metadata', sourceFilesOnDisk: -1, testFilesOnDisk: 'many' };
      },
      async runTests() { throw new Error('must not execute after malformed inspection'); },
    },
  });

  const inspectionResult = await malformedInspection.execute({ profile: 'owner', text: 'test all of Titan' });
  assert.equal(inspectionResult.mission.status, 'blocked');
  assert.match(inspectionResult.mission.signals.at(-1).detail, /invalid repository inspection result/i);
  assert.deepEqual(inspectionResult.mission.evidence, []);

  const malformedTestRoot = await workspace();
  const malformedTest = createMissionOrchestrator({
    root: malformedTestRoot,
    repositoryRoot: malformedTestRoot,
    clock: clock(),
    idFactory: () => 'malformed-test-result-1111',
    executor: {
      async inspect() {
        return { package: { name: 'athere-titan', version: '0.1.0' }, sourceFilesOnDisk: 12, testFilesOnDisk: 60 };
      },
      async runTests() {
        return { command: 17, exitCode: 0, tests: 'bogus', passed: -99, failed: 0, skipped: null, stdout: [], stderr: {} };
      },
    },
  });

  const testResult = await malformedTest.execute({ profile: 'owner', text: 'test all of Titan' });
  assert.equal(testResult.mission.status, 'blocked');
  assert.match(testResult.mission.signals.at(-1).detail, /invalid Node test result/i);
  assert.deepEqual(testResult.mission.evidence.map(({ agent }) => agent), ['nyx']);

  const inconsistentTotalsRoot = await workspace();
  const inconsistentTotals = createMissionOrchestrator({
    root: inconsistentTotalsRoot,
    repositoryRoot: inconsistentTotalsRoot,
    clock: clock(),
    idFactory: () => 'inconsistent-test-totals-1111',
    executor: {
      async inspect() {
        return { package: { name: 'athere-titan', version: '0.1.0' }, sourceFilesOnDisk: 12, testFilesOnDisk: 60 };
      },
      async runTests() {
        return {
          command: 'node --test', exitCode: 0, tests: 100, passed: 1, failed: 0, skipped: 0,
          stdout: 'incomplete totals', stderr: '',
        };
      },
    },
  });

  const totalsResult = await inconsistentTotals.execute({ profile: 'owner', text: 'test all of Titan' });
  assert.equal(totalsResult.mission.status, 'blocked');
  assert.match(totalsResult.mission.signals.at(-1).detail, /invalid Node test result/i);
});

async function workspace() {
  return mkdtemp(path.join(tmpdir(), 'titan-mission-orchestrator-'));
}

test('golden Titan test mission persists accepted running and completed states with verified proof', async () => {
  const root = await workspace();
  const bus = createMemoryResonanceBus();
  const orchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    bus,
    executor: passingExecutor(),
    clock: clock(),
    idFactory: () => '{11111111-1111-4111-8111-111111111111}',
  });

  const result = await orchestrator.execute({ profile: 'owner', text: 'Run every Titan test.' });

  assert.equal(result.revision, 5);
  assert.equal(result.mission.id, 'mission-11111111-1111-4111-8111-111111111111');
  assert.equal(result.mission.status, 'completed');
  assert.deepEqual(result.mission.signals.map(({ type }) => type), ['accepted', 'running', 'running', 'running', 'completed']);
  assert.deepEqual(result.tests, { tests: 60, passed: 60, failed: 0, skipped: 0 });
  assert.equal(result.mission.proof.verified, true);
  assert.match(result.mission.proof.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    result.mission.transitionHistory.slice(1).map(({ actor, action, input }) => ({
      actor,
      action,
      envelopeAgent: input.envelope.agent_id,
      envelopeOperation: input.envelope.operation_id,
    })),
    [
      { actor: 'miss-vale-prime', action: 'supervise_mission', envelopeAgent: 'miss-vale-prime', envelopeOperation: `${result.mission.id}-supervision` },
      { actor: 'nyx', action: 'observe_repository', envelopeAgent: 'nyx', envelopeOperation: `${result.mission.id}-inspection` },
      { actor: 'rune', action: 'execute_node_tests', envelopeAgent: 'rune', envelopeOperation: `${result.mission.id}-tests` },
      { actor: 'qra_emerge_audit', action: 'verify_proof', envelopeAgent: 'qra_emerge_audit', envelopeOperation: `${result.mission.id}-completion` },
    ],
  );
  assert.equal((await orchestrator.getMission({ missionId: result.mission.id })).revision, 5);
  assert.deepEqual(
    (await bus.read({ missionId: result.mission.id })).map(({ agent }) => agent),
    ['titan', 'miss-vale-prime', 'nyx', 'rune', 'qra_emerge_audit'],
  );
  const freshOrchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    bus: createMemoryResonanceBus(),
    executor: passingExecutor(),
  });
  const reloaded = await freshOrchestrator.getMission({ missionId: result.mission.id });
  const proof = JSON.parse(await readFile(path.join(root, reloaded.mission.proof.path), 'utf8'));
  assert.equal(proof.operationId, `${result.mission.id}-proof`);
  assert.deepEqual(proof.payload.agentEvidence.map(({ agent }) => agent), ['nyx', 'rune']);
  assert.deepEqual(proof.payload.agentEvidence[0].result, { package: { name: 'athere-titan', version: '0.1.0' }, sourceFilesOnDisk: 12, testFilesOnDisk: 60 });
  assert.deepEqual(proof.payload.agentEvidence[1].result, {
    command: 'node --test', exitCode: 0, tests: 60, passed: 60, failed: 0, skipped: 0,
  });
});

test('orchestrator records the complete mission in the authoritative state service', async () => {
  const root = await workspace();
  const orchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    executor: passingExecutor(),
    clock: clock(),
    idFactory: () => 'authoritative-orchestrator-1',
  });

  const result = await orchestrator.execute({ profile: 'owner', text: 'test all of Titan' });
  const stored = await orchestrator.getMission({ missionId: result.mission.id });

  assert.equal(stored.mission.objective, 'test all of Titan');
  assert.deepEqual(stored.mission.goals, [{ id: 'validate-titan', objective: 'Verify the complete Titan runtime' }]);
  assert.deepEqual(stored.mission.subgoals.map(({ id }) => id), ['inspect-repository', 'run-node-tests', 'verify-proof']);
  assert.deepEqual(stored.mission.completedWork, ['inspect-repository', 'run-node-tests', 'verify-proof']);
  assert.deepEqual(stored.mission.pendingWork, []);
  assert.deepEqual(stored.mission.failedWork, []);
  assert.deepEqual(stored.mission.activeAgents, []);
  // MEA: the auditor is not a recorded performer, so authoritative evidence stays nyx/rune.
  assert.deepEqual(stored.mission.evidence.map(({ agent }) => agent), ['nyx', 'rune']);
  assert.equal(stored.mission.result.auditorVerification.verified, true);
  assert.equal(stored.mission.result.qr18.verifier, 'qr18');
  assert.equal(stored.mission.result.qr18.verified, true);
  assert.equal(stored.mission.result.qr18.levels.length, 6);
  assert.deepEqual(
    stored.mission.result.qr18.levels.map(({ level, id, verified }) => ({ level, id, verified })),
    [
      { level: 1, id: 'action', verified: true },
      { level: 2, id: 'artifact', verified: true },
      { level: 3, id: 'state-transition', verified: true },
      { level: 4, id: 'subgoal', verified: true },
      { level: 5, id: 'workflow', verified: true },
      { level: 6, id: 'mission', verified: true },
    ],
  );
  assert.equal(stored.mission.artifactReferences[0].id, 'mission-proof');
  assert.equal(stored.mission.artifactReferences[0].artifactHash, stored.mission.proof.sha256);
  // Item 6: producer action and verifier decision are part of artifact lineage.
  assert.equal(stored.mission.artifactReferences[0].agent, 'qra_emerge_audit');
  assert.equal(stored.mission.artifactReferences[0].action, 'verified_mission_proof');
  assert.equal(stored.mission.artifactReferences[0].verifierResult.verifier, 'qra_emerge_audit');
  assert.equal(stored.mission.artifactReferences[0].verifierResult.verified, true);
  assert.equal(stored.mission.artifactReferences[0].verifierResult.proofSha256, stored.mission.proof.sha256);
  assert.equal(stored.mission.artifactReferences[0].verified, true);
  assert.equal(stored.mission.currentPlan.version, 1);
  assert.equal(stored.mission.environmentObservations[0].key, 'repository_root');
  assert.deepEqual(
    await orchestrator.selectMissionState({ missionId: result.mission.id, fields: ['objective', 'pendingWork', 'currentPlan'] }),
    { missionId: result.mission.id, stateVersion: 5, objective: 'test all of Titan', pendingWork: [], currentPlan: stored.mission.currentPlan },
  );
});

test('failed executor stores a blocked mission with its real failure and no proof completion', async () => {
  const root = await workspace();
  const bus = createMemoryResonanceBus();
  const orchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    bus,
    clock: clock(),
    idFactory: () => '22222222-2222-4222-8222-222222222222',
    executor: {
      async inspect() { return { package: { name: 'athere-titan', version: '0.1.0' }, sourceFilesOnDisk: 1, testFilesOnDisk: 1 }; },
      async runTests() {
        return { command: 'node --test', exitCode: 1, tests: 3, passed: 2, failed: 1, skipped: 0, stdout: 'failed', stderr: 'real runner failure' };
      },
    },
  });

  const result = await orchestrator.execute({ profile: 'owner', text: 'test all of Titan' });

  assert.equal(result.revision, 5);
  assert.equal(result.mission.status, 'blocked');
  assert.equal(result.mission.proof, undefined);
  assert.match(result.mission.signals.at(-1).detail, /exit code 1.*failed 1/i);
  assert.equal(result.mission.signals.at(-1).agent, 'qra_recovery_driver');
  assert.equal((await bus.read({ missionId: result.mission.id })).at(-1).agent, 'qra_recovery_driver');
});

test('non-execution plans do not create missions or invoke deterministic executors', async () => {
  const root = await workspace();
  let calls = 0;
  const orchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    executor: {
      async inspect() { calls += 1; return {}; },
      async runTests() { calls += 1; return {}; },
    },
  });

  assert.equal((await orchestrator.execute({ profile: 'owner', text: 'Make it better over there' })).status, 'needs_clarification');
  assert.equal((await orchestrator.execute({ profile: 'public', text: 'Inspect Titan logs on Ubuntu through SSH' })).status, 'denied');
  assert.equal((await orchestrator.execute({ profile: 'owner', text: 'Deploy Vale Prime to the QRA forces and every fleet cluster' })).status, 'needs_approval');
  assert.deepEqual(
    await orchestrator.execute({ profile: 'owner', text: 'Build Titan now' }),
    { status: 'blocked', reason: 'no operational executor for build' },
  );
  assert.equal(calls, 0);
});

test('recovery blocks interrupted missions without rerunning a deterministic executor', async () => {
  const root = await workspace();
  await saveMission({ root, mission: createMission({ id: 'mission-interrupted', intent: 'Run all Titan tests', clock: clock() }) });
  let executions = 0;
  const orchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    executor: {
      async inspect() { executions += 1; return {}; },
      async runTests() { executions += 1; return {}; },
    },
  });

  assert.deepEqual(await orchestrator.recover(), {
    recovered: [{ missionId: 'mission-interrupted', revision: 2 }],
    blocked: [],
    corrupt: [],
  });
  const record = await orchestrator.getMission({ missionId: 'mission-interrupted' });
  assert.equal(record.mission.status, 'blocked');
  assert.equal(record.mission.signals.at(-1).agent, 'qra_recovery_driver');
  assert.equal(executions, 0);
});

test('telemetry publishing failures cannot overturn a durably completed mission', async () => {
  const root = await workspace();
  const throwingBus = { async publish() { throw new Error('telemetry offline'); } };
  const orchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    bus: throwingBus,
    executor: passingExecutor(),
    clock: clock(),
    idFactory: () => '33333333-3333-4333-8333-333333333333',
  });

  const result = await orchestrator.execute({ profile: 'owner', text: 'Run every Titan test.' });

  assert.equal(result.revision, 5);
  assert.equal(result.mission.status, 'completed');
  const freshOrchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    bus: createMemoryResonanceBus(),
    executor: passingExecutor(),
  });
  assert.equal((await freshOrchestrator.getMission({ missionId: result.mission.id })).mission.status, 'completed');
});

// Network buses (Redis) set failClosedOnPublish. A swallowed transport failure
 // would look like "signal delivered" while the remote stream stays empty —
 // the exact silent-empty-stream failure the seed guard exists to prevent.
test('network-bus publish failure fails closed and does not complete the mission', async () => {
  const root = await workspace();
  const throwingBus = {
    failClosedOnPublish: true,
    async publish() { throw new Error('redis connection failed: ECONNREFUSED'); },
  };
  const orchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    bus: throwingBus,
    executor: passingExecutor(),
    clock: clock(),
    idFactory: () => '44444444-4444-4444-8444-444444444444',
  });

  await assert.rejects(
    () => orchestrator.execute({ profile: 'owner', text: 'Run every Titan test.' }),
    /redis connection failed|ECONNREFUSED|resonance publish failed/i,
  );
});

test('orchestrator dispatches inspect and run-node-tests through an injected remote work queue', async () => {
  const root = await workspace();
  const { createMemoryRemoteWorkQueue } = await import('../../packages/execution/src/remote-work-queue.js');
  const { runRemoteExecutorWorkerOnce } = await import('../../packages/execution/src/remote-executor-worker.js');
  const queue = createMemoryRemoteWorkQueue();

  const kinds = [];
  const worker = (async () => {
    let last = null;
    while (kinds.length < 2) {
      const report = await runRemoteExecutorWorkerOnce({
        workQueue: queue,
        workerId: 'orchestrator-remote-worker',
        identity: { hostname: 'ichabodcrane', pid: 77 },
        claimTimeoutMs: 50,
        executor: {
          async inspect() {
            return { package: { name: 'athere-mesh', version: '0.1.0' }, sourceFilesOnDisk: 3, testFilesOnDisk: 9 };
          },
          async runTests() {
            return {
              command: 'node --test',
              exitCode: 0,
              tests: 4,
              passed: 4,
              failed: 0,
              skipped: 0,
              stdout: 'ok',
              stderr: '',
            };
          },
        },
      });
      if (report.reason === 'no-job') {
        await new Promise((resolve) => setTimeout(resolve, 20));
        continue;
      }
      kinds.push(report.kind);
      last = report;
    }
    return last;
  })();

  const orchestrator = createMissionOrchestrator({
    root,
    repositoryRoot: root,
    bus: createMemoryResonanceBus(),
    executor: {
      async inspect() {
        throw new Error('local inspect must not run when remoteWorkQueue is injected');
      },
      async runTests() {
        throw new Error('local runTests must not run when remoteWorkQueue is injected');
      },
    },
    remoteWorkQueue: queue,
    remoteRepositoryRoot: '/remote/athere-mesh',
    clock: clock(),
    idFactory: () => '55555555-5555-4555-8555-555555555555',
  });

  const result = await orchestrator.execute({ profile: 'owner', text: 'test all of Titan' });
  const workerReport = await worker;

  assert.equal(result.mission.status, 'completed');
  assert.deepEqual(result.tests, { tests: 4, passed: 4, failed: 0, skipped: 0 });
  assert.deepEqual(kinds, ['inspect-repository', 'run-node-tests']);
  assert.equal(workerReport.ok, true);
  assert.equal(workerReport.worker.hostname, 'ichabodcrane');
  await queue.close();
});
