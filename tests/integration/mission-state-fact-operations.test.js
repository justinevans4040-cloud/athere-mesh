import test from 'node:test';
import assert from 'node:assert/strict';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { createMissionStoreBridge } from '../../packages/mission/src/mission-store.js';

const clockValues = [
  '2026-08-31T14:20:00.000Z',
  '2026-08-31T14:20:01.000Z',
  '2026-08-31T14:20:02.000Z',
  '2026-08-31T14:20:03.000Z',
  '2026-08-31T14:20:04.000Z',
];
function createClock() { let i = 0; return () => clockValues[Math.min(i++, clockValues.length - 1)]; }

function createStore() {
  let record;
  return createMissionStoreBridge({
    async loadMission() { if (!record) throw new Error('missing mission'); return structuredClone(record); },
    async saveMission({ mission, expectedRevision }) {
      if (record && expectedRevision !== record.revision) throw new Error(`revision conflict: expected ${expectedRevision}, found ${record.revision}`);
      const revision = record ? record.revision + 1 : 1;
      record = { mission: structuredClone(mission), revision };
      return structuredClone(record);
    },
  });
}

function input() {
  return {
    operationId: 'op-create-facts-1',
    id: 'mission-facts-1',
    objective: 'Maintain authoritative facts safely',
    goals: [{ id: 'goal-1', objective: 'Keep state correct' }],
    subgoals: [{ id: 'observe', objective: 'Observe state', goalId: 'goal-1' }],
    dependencies: [],
    constraints: [],
    permissions: [{ actor: 'nyx', actions: ['observe_repository', 'record_fact', 'supersede_fact', 'correct_fact', 'revoke_fact'] }],
    currentPlan: { id: 'plan-1', version: 1, steps: ['observe'] },
    environmentObservations: [],
    authoritativeFacts: [{ id: 'server-ip-v3', key: 'SERVER_IP', value: '100.64.0.10', status: 'current' }],
  };
}

async function createService() {
  const service = createMissionStateService({ root: '/state', clock: createClock(), store: createStore() });
  const created = await service.create(input());
  return { service, created };
}

test('generic transitions cannot replace authoritative fact collections', async () => {
  const { service, created } = await createService();
  await assert.rejects(
    service.transition({
      operationId: 'op-reject-generic-facts-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx' },
      update: { authoritativeFacts: [] },
    }),
    /authoritativeFacts must be changed through atomic fact operations/,
  );
});

test('supersedeFact atomically retires the current fact and installs one successor', async () => {
  const { service, created } = await createService();
  const saved = await service.supersedeFact({
    operationId: 'op-supersede-fact-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    actor: 'nyx',
    factId: 'server-ip-v3',
    successor: { id: 'server-ip-v4', value: '100.64.0.11' },
    reason: 'verified address change',
    evidence: { source: 'runtime-probe' },
  });
  assert.equal(saved.revision, 2);
  assert.deepEqual(await service.facts({ missionId: created.mission.id, key: 'SERVER_IP' }), [
    { id: 'server-ip-v4', key: 'SERVER_IP', value: '100.64.0.11', status: 'current', supersedes: 'server-ip-v3' },
  ]);
  const historyFacts = await service.facts({ missionId: created.mission.id, key: 'SERVER_IP', includeHistorical: true });
  assert.deepEqual(historyFacts.map(({ id, status }) => ({ id, status })), [
    { id: 'server-ip-v3', status: 'superseded' },
    { id: 'server-ip-v4', status: 'current' },
  ]);
  const lineage = await service.history({ missionId: created.mission.id });
  assert.equal(lineage.at(-1).action, 'supersede_fact');
  assert.deepEqual(lineage.at(-1).evidence, { source: 'runtime-probe' });
  assert.equal((await service.verifyHistory({ missionId: created.mission.id })).valid, true);
});

test('ordinary mission reads expose current facts only and history requires an explicit request', async () => {
  const { service, created } = await createService();
  await service.supersedeFact({
    operationId: 'op-supersede-read-boundary-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    actor: 'nyx',
    factId: 'server-ip-v3',
    successor: { id: 'server-ip-v4', value: '100.64.0.11' },
    reason: 'verified address change',
  });

  const ordinary = await service.get({ missionId: created.mission.id });
  assert.deepEqual(ordinary.mission.authoritativeFacts.map(({ id }) => id), ['server-ip-v4']);
  assert.equal(ordinary.mission.transitionHistory, undefined);
  const historical = await service.get({ missionId: created.mission.id, includeHistorical: true });
  assert.deepEqual(historical.mission.authoritativeFacts.map(({ id }) => id), ['server-ip-v3', 'server-ip-v4']);
  assert.equal(historical.mission.transitionHistory.at(-1).action, 'supersede_fact');
});

test('correctFact records correction lineage without exposing the incorrect value as current', async () => {
  const { service, created } = await createService();
  await service.correctFact({
    operationId: 'op-correct-fact-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    actor: 'nyx',
    factId: 'server-ip-v3',
    successor: { id: 'server-ip-corrected', value: '100.64.0.12' },
    reason: 'prior observation was incorrect',
  });
  const facts = await service.facts({ missionId: created.mission.id, key: 'SERVER_IP', includeHistorical: true });
  assert.equal(facts[0].status, 'corrected');
  assert.equal(facts[0].correctedBy, 'server-ip-corrected');
  assert.equal(facts[1].status, 'current');
  assert.equal(facts[1].supersedes, 'server-ip-v3');
});

test('revokeFact removes a revoked fact from normal agent retrieval and preserves explicit history', async () => {
  const { service, created } = await createService();
  await service.revokeFact({
    operationId: 'op-revoke-fact-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    actor: 'nyx',
    factId: 'server-ip-v3',
    reason: 'source authority withdrawn',
  });
  assert.deepEqual(await service.facts({ missionId: created.mission.id, key: 'SERVER_IP' }), []);
  const historical = await service.facts({ missionId: created.mission.id, key: 'SERVER_IP', includeHistorical: true });
  assert.equal(historical[0].status, 'revoked');
  assert.equal(historical[0].reason, 'source authority withdrawn');
  assert.match(historical[0].revokedAt, /^2026-08-31T14:20:/);
});

test('recordFact refuses to create a second current fact and requires explicit supersession', async () => {
  const { service, created } = await createService();
  await assert.rejects(
    service.recordFact({
      operationId: 'op-record-duplicate-fact-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      actor: 'nyx',
      fact: { id: 'server-ip-v4', key: 'SERVER_IP', value: '100.64.0.11', status: 'current' },
    }),
    /current fact already exists for key SERVER_IP; supersede or correct it explicitly/,
  );
});

test('atomic fact operations enforce declared actor capabilities', async () => {
  const store = createStore();
  const data = input();
  data.permissions = [{ actor: 'nyx', actions: ['observe_repository'] }];
  const service = createMissionStateService({ root: '/state', clock: createClock(), store });
  const created = await service.create(data);
  await assert.rejects(
    service.revokeFact({ operationId: 'op-denied-revoke-1', missionId: created.mission.id, expectedRevision: created.revision, actor: 'nyx', factId: 'server-ip-v3', reason: 'test' }),
    /actor nyx lacks required permission: revoke_fact/,
  );
});

test('atomic fact operations reject stale revisions without changing authority', async () => {
  const { service, created } = await createService();
  await assert.rejects(
    service.supersedeFact({
      operationId: 'op-stale-supersede-1',
      missionId: created.mission.id,
      expectedRevision: created.revision + 1,
      actor: 'nyx',
      factId: 'server-ip-v3',
      successor: { id: 'server-ip-v4', value: '100.64.0.11' },
      reason: 'stale caller',
    }),
    /revision conflict/,
  );
  assert.deepEqual(await service.facts({ missionId: created.mission.id, key: 'SERVER_IP' }), [
    { id: 'server-ip-v3', key: 'SERVER_IP', value: '100.64.0.10', status: 'current' },
  ]);
});

test('fact operation IDs suppress exact retries and reject conflicting reuse', async () => {
  const { service, created } = await createService();
  const request = {
    operationId: 'op-supersede-server-ip-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    actor: 'nyx',
    factId: 'server-ip-v3',
    successor: { id: 'server-ip-v4', value: '100.64.0.11' },
    reason: 'verified address change',
    evidence: { source: 'runtime-probe' },
  };

  const first = await service.supersedeFact(request);
  const retry = await service.supersedeFact(request);

  assert.equal(first.revision, 2);
  assert.equal(retry.revision, 2);
  assert.equal(retry.duplicate, true);
  assert.equal((await service.history({ missionId: created.mission.id })).length, 2);
  await assert.rejects(
    service.supersedeFact({ ...request, reason: 'different operation' }),
    /idempotency conflict/i,
  );
});

test('concurrent retries converge on one committed fact mutation', async () => {
  const { service, created } = await createService();
  const request = {
    operationId: 'op-concurrent-revoke-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    actor: 'nyx',
    factId: 'server-ip-v3',
    reason: 'concurrent verified revocation',
  };

  const results = await Promise.all([service.revokeFact(request), service.revokeFact(request)]);

  assert.deepEqual(results.map(({ revision }) => revision), [2, 2]);
  assert.equal(results.filter(({ duplicate }) => duplicate === true).length, 1);
  assert.equal((await service.history({ missionId: created.mission.id })).length, 2);
});

test('fact mutations require a caller-supplied operation ID', async () => {
  const { service, created } = await createService();
  await assert.rejects(
    service.recordFact({
      missionId: created.mission.id,
      expectedRevision: created.revision,
      actor: 'nyx',
      fact: { id: 'region-1', key: 'REGION', value: 'us-west', status: 'current' },
    }),
    /operation id must be a non-empty string/i,
  );
});

test('mission creation rejects ambiguous current facts', async () => {
  const store = createStore();
  const data = input();
  data.authoritativeFacts = [
    { id: 'ip-a', key: 'SERVER_IP', value: '10.0.0.1', status: 'current' },
    { id: 'ip-b', key: 'SERVER_IP', value: '10.0.0.2', status: 'current' },
  ];
  const service = createMissionStateService({ root: '/state', clock: createClock(), store });
  await assert.rejects(service.create(data), /multiple current authoritative facts for key: SERVER_IP/);
});

test('mission creation rejects broken cross-key supersession lineage', async () => {
  const store = createStore();
  const data = input();
  data.authoritativeFacts = [
    { id: 'ip-a', key: 'SERVER_IP', value: '10.0.0.1', status: 'superseded', supersededBy: 'ip-b' },
    { id: 'ip-b', key: 'OTHER_KEY', value: '10.0.0.2', status: 'current', supersedes: 'ip-a' },
  ];
  const service = createMissionStateService({ root: '/state', clock: createClock(), store });
  await assert.rejects(service.create(data), /fact lineage key mismatch/);
});

test('mission creation rejects revoked facts without a revocation timestamp', async () => {
  const store = createStore();
  const data = input();
  data.authoritativeFacts = [{ id: 'revoked-ip', key: 'SERVER_IP', value: '10.0.0.1', status: 'revoked' }];
  const service = createMissionStateService({ root: '/state', clock: createClock(), store });
  await assert.rejects(service.create(data), /revoked fact revoked-ip requires revokedAt/);
});
