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
  assert.equal(stored.mission.artifactReferences[0].agent, 'qra_emerge_audit');
  assert.equal(stored.mission.artifactReferences[0].action, 'verified_mission_proof');
  assert.equal(stored.mission.artifactReferences[0].missionStateVersion, 4);
  assert.deepEqual(stored.mission.artifactReferences[0].verifierResult, {
    verifier: 'qra_emerge_audit', verified: true, proofSha256: stored.mission.proof.sha256,
  });
  assert.deepEqual(immediate.tests, stored.mission.result.tests);
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
  assert.deepEqual(proof.agentEvidence.map(({ agent }) => agent), ['nyx', 'rune']);
  assert.deepEqual(proof.agentEvidence[0].result, { package: { name: 'athere-titan', version: '0.1.0' }, sourceFilesOnDisk: 12, testFilesOnDisk: 60 });
  assert.deepEqual(proof.agentEvidence[1].result, {
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
  assert.deepEqual(stored.mission.evidence.map(({ agent }) => agent), ['nyx', 'rune', 'qra_emerge_audit']);
  assert.equal(stored.mission.artifactReferences[0].id, 'mission-proof');
  assert.equal(stored.mission.artifactReferences[0].artifactHash, stored.mission.proof.sha256);
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
