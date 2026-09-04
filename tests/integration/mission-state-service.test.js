import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService as createRawMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { loadMission, saveMission } from '../../packages/mission/src/mission-store.js';

const clock = () => '2026-08-26T18:00:00.000Z';
function withAgentEnvelopes(service) {
  return {
    ...service,
    async transition(request) {
      if (!request.operationId || request.envelope) return service.transition(request);
      return service.transition({
        ...request,
        envelope: createAgentOperationEnvelope({
          record: { mission: { id: request.missionId }, revision: request.expectedRevision },
          operationId: request.operationId,
          agentId: request.signal.agent,
          objective: 'exercise an authorized mission transition',
          createdAt: clock(),
        }),
      });
    },
  };
}
function createMissionStateService(options) {
  return withAgentEnvelopes(createRawMissionStateService(options));
}
const createInput = () => ({
  operationId: 'op-create-authoritative-1',
  id: 'mission-authoritative-1',
  objective: 'Prove the complete mission state survives agent context loss',
  goals: [{ id: 'goal-1', objective: 'Persist authoritative state' }],
  subgoals: [{ id: 'inspect', objective: 'Inspect repository', goalId: 'goal-1' }, { id: 'verify', objective: 'Verify persistence', goalId: 'goal-1' }],
  dependencies: [{ prerequisite: 'inspect', dependent: 'verify' }],
  constraints: ['no model-authored completion'],
  permissions: [
    { actor: 'nyx', actions: ['observe_repository'] },
    { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
  ],
  currentPlan: { id: 'plan-1', version: 1, steps: ['inspect', 'verify'] },
  environmentObservations: [{ source: 'runtime', key: 'node_version', value: '24.14.1', observedAt: '2026-08-26T17:59:00.000Z' }],
});

test('authoritative mission state survives service reconstruction with every owned field', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-state-service-'));
  const service = createMissionStateService({ root, clock });

  const created = await service.create(createInput());
  const executed = await service.transition({
    operationId: 'op-persist-executor-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'inspection evidence recorded' },
    update: {
      evidence: [{ id: 'evidence-inspect', kind: 'repository_observation', agent: 'nyx', verifier: 'repository-observation-check' }],
      activeAgents: ['nyx'],
      artifactReferences: [{ id: 'artifact-tree', path: 'evidence/tree.json' }],
    },
  });
  const running = await service.transition({
    operationId: 'op-persist-authoritative-1',
    missionId: created.mission.id,
    expectedRevision: executed.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit', detail: 'auditor certifies inspection' },
    update: {
      completedWork: ['inspect'],
      pendingWork: ['verify'],
      failedWork: [],
      activeAgents: [],
    },
  });

  const restarted = createMissionStateService({ root, clock });
  const loaded = await restarted.get({ missionId: created.mission.id });

  assert.equal(loaded.revision, 3);
  assert.equal(running.revision, 3);
  assert.deepEqual(loaded.mission.goals, [{ id: 'goal-1', objective: 'Persist authoritative state' }]);
  assert.deepEqual(loaded.mission.subgoals.map(({ id }) => id), ['inspect', 'verify']);
  assert.deepEqual(loaded.mission.dependencies, [{ prerequisite: 'inspect', dependent: 'verify' }]);
  assert.deepEqual(loaded.mission.completedWork, ['inspect']);
  assert.deepEqual(loaded.mission.pendingWork, ['verify']);
  assert.deepEqual(loaded.mission.failedWork, []);
  assert.deepEqual(loaded.mission.evidence, [{ id: 'evidence-inspect', kind: 'repository_observation', agent: 'nyx', verifier: 'repository-observation-check' }]);
  assert.deepEqual(loaded.mission.constraints, ['no model-authored completion']);
  assert.deepEqual(loaded.mission.permissions, [
    { actor: 'nyx', actions: ['observe_repository'] },
    { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
  ]);
  assert.deepEqual(loaded.mission.activeAgents, []);
  assert.deepEqual(loaded.mission.artifactReferences, [{ id: 'artifact-tree', path: 'evidence/tree.json' }]);
  assert.deepEqual(loaded.mission.currentPlan, { id: 'plan-1', version: 1, steps: ['inspect', 'verify'] });
  assert.deepEqual(loaded.mission.environmentObservations, createInput().environmentObservations);
  assert.deepEqual(loaded.mission.authoritativeFacts, []);
});

test('every authoritative mutation appends hash-bound transition lineage', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-state-lineage-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput());
  const executed = await service.transition({
    operationId: 'op-lineage-executor-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'inspection evidence recorded', evidence: { path: 'evidence/tree.json' } },
    update: {
      evidence: [{ agent: 'nyx', path: 'evidence/tree.json' }],
      activeAgents: ['nyx'],
    },
  });
  await service.transition({
    operationId: 'op-lineage-running-1',
    missionId: created.mission.id,
    expectedRevision: executed.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit', detail: 'auditor certifies inspection', evidence: { path: 'evidence/tree.json' } },
    update: { completedWork: ['inspect'], pendingWork: ['verify'], activeAgents: [] },
  });

  const history = await service.history({ missionId: created.mission.id });

  assert.equal(history.length, 3);
  assert.deepEqual(
    history.map(({ stateVersion, previousVersion, actor, action, transitionResult, rollbackTargetVersion }) => ({ stateVersion, previousVersion, actor, action, transitionResult, rollbackTargetVersion })),
    [
      { stateVersion: 1, previousVersion: 0, actor: 'titan', action: 'create', transitionResult: 'committed', rollbackTargetVersion: null },
      { stateVersion: 2, previousVersion: 1, actor: 'nyx', action: 'observe_repository', transitionResult: 'committed', rollbackTargetVersion: 1 },
      { stateVersion: 3, previousVersion: 2, actor: 'qra_emerge_audit', action: 'verify_proof', transitionResult: 'committed', rollbackTargetVersion: 2 },
    ],
  );
  assert.equal(history[2].timestamp, '2026-08-26T18:00:00.000Z');
  assert.deepEqual(history[2].input.signal, { type: 'running', agent: 'qra_emerge_audit', detail: 'auditor certifies inspection', evidence: { path: 'evidence/tree.json' } });
  assert.deepEqual(history[2].input.update, { completedWork: ['inspect'], pendingWork: ['verify'], activeAgents: [] });
  assert.deepEqual(history[2].evidence, { path: 'evidence/tree.json' });
  assert.deepEqual(history[2].authorization, { actor: 'qra_emerge_audit', actions: ['verify_proof'], granted: true });
  assert.equal(history[2].verifier, 'mission-state-service');
  assert.match(history[2].previousStateHash, /^[a-f0-9]{64}$/);
  assert.match(history[2].stateHash, /^[a-f0-9]{64}$/);
  assert.equal(history[0].previousTransitionHash, null);
  assert.match(history[0].transitionHash, /^[a-f0-9]{64}$/);
  assert.equal(history[1].previousTransitionHash, history[0].transitionHash);
  assert.equal(history[2].previousTransitionHash, history[1].transitionHash);
  assert.match(history[2].transitionHash, /^[a-f0-9]{64}$/);
  assert.notEqual(history[2].previousStateHash, history[2].stateHash);
  assert.deepEqual(Object.keys(history[2].changes).sort(), ['activeAgents', 'completedWork', 'pendingWork', 'signals'].sort());
  assert.deepEqual(await service.verifyHistory({ missionId: created.mission.id }), {
    valid: true,
    missionId: created.mission.id,
    stateVersion: 3,
    transitionCount: 3,
    stateHash: history[2].stateHash,
  });
});

test('history verification rejects a tampered transition ledger', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-state-tamper-'));
  const baseStore = { loadMission, saveMission };
  let tamper = false;
  const store = {
    saveMission: baseStore.saveMission,
    async loadMission(options) {
      const record = await baseStore.loadMission(options);
      if (!tamper) return record;
      const history = structuredClone(record.mission.transitionHistory);
      history[0].actor = 'intruder';
      return { ...record, mission: { ...record.mission, transitionHistory: history } };
    },
  };
  const service = createMissionStateService({ root, clock, store });
  await service.create(createInput());
  tamper = true;
  await assert.rejects(() => service.verifyHistory({ missionId: 'mission-authoritative-1' }), /transition hash mismatch at version 1/);
});

test('transition marks an explicit provenance boundary for a pre-ledger mission', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-state-legacy-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput());
  const legacyMission = structuredClone(created.mission);
  delete legacyMission.transitionHistory;
  let saved;
  const store = {
    loadMission: async () => ({ mission: legacyMission, revision: created.revision }),
    saveMission: async ({ mission }) => { saved = mission; return { mission, revision: 2 }; },
  };
  const legacyService = createMissionStateService({ root, clock, store });

  await legacyService.transition({
    operationId: 'op-legacy-running-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'legacy mutation' },
  });

  assert.equal(saved.transitionHistory[0].action, 'import_legacy_snapshot');
  assert.deepEqual(saved.transitionHistory[0].input, { provenance: 'pre-ledger snapshot', priorHistoryAvailable: false });
  assert.equal(saved.transitionHistory[0].previousStateHash, null);
  assert.equal(saved.transitionHistory[0].rollbackTargetVersion, null);
  assert.equal(saved.transitionHistory[1].previousTransitionHash, saved.transitionHistory[0].transitionHash);
});

test('agents receive only explicitly selected authoritative state', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-state-view-'));
  const service = createMissionStateService({ root, clock });
  await service.create(createInput());

  const selected = await service.select({
    missionId: 'mission-authoritative-1',
    fields: ['objective', 'subgoals', 'currentPlan', 'environmentObservations'],
  });

  assert.deepEqual(Object.keys(selected), ['missionId', 'stateVersion', 'objective', 'subgoals', 'currentPlan', 'environmentObservations']);
  assert.equal(selected.permissions, undefined);
  assert.equal(selected.signals, undefined);
});

test('state service rejects unknown mutations and stale revisions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-state-guard-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput());

  await assert.rejects(
    service.transition({
      operationId: 'op-guard-unknown-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx' },
      update: { modelOpinion: 'done' },
    }),
    /unsupported authoritative state field: modelOpinion/,
  );
  await assert.rejects(
    service.transition({
      operationId: 'op-guard-revision-1',
      missionId: created.mission.id,
      expectedRevision: 0,
      signal: { type: 'running', agent: 'nyx' },
      update: {},
    }),
    /revision conflict/,
  );
});

test('state service rejects corrupt work partitions and unauthorized active agents', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-state-integrity-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput());

  await assert.rejects(
    service.transition({
      operationId: 'op-integrity-missing-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'qra_emerge_audit' },
      update: { completedWork: ['missing-subgoal'] },
    }),
    /work references unknown subgoal: missing-subgoal/,
  );
  await assert.rejects(
    service.transition({
      operationId: 'op-integrity-overlap-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'qra_emerge_audit' },
      update: { completedWork: ['inspect'], pendingWork: ['inspect', 'verify'] },
    }),
    /work partitions overlap: inspect/,
  );
  await assert.rejects(
    service.transition({
      operationId: 'op-integrity-executor-completed-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx' },
      update: { completedWork: ['inspect'], pendingWork: ['verify'] },
    }),
    /only auditor may certify subgoal success/,
  );
  await assert.rejects(
    service.transition({
      operationId: 'op-integrity-agent-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx' },
      update: { activeAgents: ['unregistered-agent'] },
    }),
    /active agent lacks mission permission: unregistered-agent/,
  );
  await assert.rejects(
    service.transition({
      operationId: 'op-integrity-actor-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'unregistered-agent' },
      update: {},
    }),
    /unknown operational agent: unregistered-agent/,
  );
  await assert.rejects(
    service.transition({
      operationId: 'op-integrity-permission-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx' },
      update: { permissions: [{ actor: 'nyx', actions: ['certify_own_success'] }] },
    }),
    /unsupported authoritative state field: permissions/,
  );
});

test('state transitions reject missing envelopes and capability-incompatible completion attempts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-state-envelope-guard-'));
  const rawService = createRawMissionStateService({ root, clock });
  const created = await rawService.create(createInput());
  const request = {
    operationId: 'op-envelope-required-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx' },
  };
  await assert.rejects(rawService.transition(request), /agent envelope/i);

  const incompatible = createAgentOperationEnvelope({
    record: created,
    operationId: 'op-forged-completion-1',
    agentId: 'nyx',
    objective: 'attempt an unauthorized completion',
    createdAt: clock(),
  });
  await assert.rejects(rawService.transition({
    operationId: 'op-forged-completion-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: {
      type: 'completed',
      agent: 'nyx',
      proof: { verified: true, path: 'proofs/forged.json', sha256: 'a'.repeat(64), operationId: 'forged-proof' },
    },
    envelope: incompatible,
  }), /cannot perform completed transition/i);
  assert.equal((await rawService.get({ missionId: created.mission.id })).mission.status, 'accepted');
});

test('the authoritative completion boundary re-reads and verifies proof bytes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-state-proof-boundary-'));
  const rawService = createRawMissionStateService({ root, clock });
  const created = await rawService.create({
    ...createInput(),
    operationId: 'op-create-proof-boundary-1',
    id: 'mission-proof-boundary-1',
    permissions: [
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
    ],
  });
  const runningOperation = 'op-proof-boundary-running-1';
  const running = await rawService.transition({
    operationId: runningOperation,
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'miss-vale-prime' },
    envelope: createAgentOperationEnvelope({
      record: created,
      operationId: runningOperation,
      agentId: 'miss-vale-prime',
      objective: 'supervise proof-bound completion',
      createdAt: clock(),
    }),
  });
  const completionOperation = 'op-proof-boundary-complete-1';
  await assert.rejects(rawService.transition({
    operationId: completionOperation,
    missionId: created.mission.id,
    expectedRevision: running.revision,
    signal: {
      type: 'completed',
      agent: 'qra_emerge_audit',
      proof: { verified: true, path: 'proofs/missing.json', sha256: 'a'.repeat(64), operationId: 'missing-proof' },
    },
    // MEA: completed still requires auditor-certified work coverage; this test
    // isolates the proof re-read boundary after that gate.
    update: {
      completedWork: ['inspect', 'verify'],
      pendingWork: [],
      activeAgents: [],
    },
    envelope: createAgentOperationEnvelope({
      record: running,
      operationId: completionOperation,
      agentId: 'qra_emerge_audit',
      objective: 'verify completion proof',
      createdAt: clock(),
    }),
  }), (error) => error.code === 'ENOENT');
  assert.equal((await rawService.get({ missionId: created.mission.id })).mission.status, 'running');
});

test('transition operation IDs suppress exact retries and reject conflicting reuse', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-state-idempotency-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput());
  const request = {
    operationId: 'op-inspect-running-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'inspection started' },
    update: { activeAgents: ['nyx'] },
  };

  const first = await service.transition(request);
  const retry = await service.transition(request);

  assert.equal(first.revision, 2);
  assert.equal(retry.revision, 2);
  assert.equal(retry.duplicate, true);
  assert.equal((await service.history({ missionId: created.mission.id })).length, 2);
  await assert.rejects(
    service.transition({ ...request, signal: { ...request.signal, detail: 'different operation' } }),
    /idempotency conflict/i,
  );
});

test('concurrent retries against the durable store converge on one transition', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-state-concurrent-retry-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create(createInput());
  const request = {
    operationId: 'op-concurrent-running-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'concurrent retry' },
    update: { activeAgents: ['nyx'] },
  };

  const results = await Promise.all(Array.from({ length: 8 }, () => service.transition(request)));

  assert.equal(results.every(({ revision }) => revision === 2), true);
  assert.equal(results.filter(({ duplicate }) => duplicate !== true).length, 1);
  assert.equal((await service.history({ missionId: created.mission.id })).length, 2);
});

test('operation retry timeout fails without committing partial state', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-operation-timeout-'));
  const initial = createMissionStateService({ root, clock });
  const created = await initial.create(createInput());
  const busyStore = {
    loadMission,
    async saveMission() { throw new Error('mission write already in progress'); },
  };
  const service = createMissionStateService({
    root,
    clock,
    store: busyStore,
    operationRetryTimeoutMs: 25,
    operationRetryDelayMs: 5,
  });

  await assert.rejects(
    service.transition({
      operationId: 'op-timeout-running-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx', detail: 'must not commit' },
      update: { activeAgents: ['nyx'] },
    }),
    /operation retry timed out after 25ms/,
  );
  const unchanged = await initial.get({ missionId: created.mission.id, includeHistorical: true });
  assert.equal(unchanged.revision, 1);
  assert.equal(unchanged.mission.status, 'accepted');
  assert.equal(unchanged.mission.transitionHistory.length, 1);
});

test('mission creation operation IDs return the existing mission only for an exact retry', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-create-idempotency-'));
  const service = createMissionStateService({ root, clock });
  const request = { ...createInput(), operationId: 'op-create-mission-1' };

  const first = await service.create(request);
  const retry = await service.create(request);

  assert.equal(first.revision, 1);
  assert.equal(retry.revision, 1);
  assert.equal(retry.duplicate, true);
  assert.equal((await service.history({ missionId: request.id })).length, 1);
  await assert.rejects(
    service.create({ ...request, objective: 'different mission' }),
    /idempotency conflict/i,
  );
});

test('state-changing service operations require a caller-supplied operation ID', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-required-operation-id-'));
  const service = createMissionStateService({ root, clock });

  const { operationId: ignored, ...withoutOperationId } = createInput();
  await assert.rejects(service.create(withoutOperationId), /operation id must be a non-empty string/i);
  const created = await service.create({ ...createInput(), operationId: 'op-required-create-1' });
  await assert.rejects(
    service.transition({
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx' },
    }),
    /operation id must be a non-empty string/i,
  );
});
