import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

const clock = () => '2026-08-26T18:00:00.000Z';
const createInput = () => ({
  id: 'mission-authoritative-1',
  objective: 'Prove the complete mission state survives agent context loss',
  goals: [{ id: 'goal-1', objective: 'Persist authoritative state' }],
  subgoals: [{ id: 'inspect', objective: 'Inspect repository', goalId: 'goal-1' }, { id: 'verify', objective: 'Verify persistence', goalId: 'goal-1' }],
  dependencies: [{ prerequisite: 'inspect', dependent: 'verify' }],
  constraints: ['no model-authored completion'],
  permissions: [{ actor: 'nyx', actions: ['observe_repository'] }],
  currentPlan: { id: 'plan-1', version: 1, steps: ['inspect', 'verify'] },
  environmentObservations: [{ source: 'runtime', key: 'node_version', value: '24.14.1', observedAt: '2026-08-26T17:59:00.000Z' }],
});

test('authoritative mission state survives service reconstruction with every owned field', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-state-service-'));
  const service = createMissionStateService({ root, clock });

  const created = await service.create(createInput());
  const running = await service.transition({
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'inspection complete' },
    update: {
      completedWork: ['inspect'],
      pendingWork: ['verify'],
      failedWork: [],
      evidence: [{ id: 'evidence-inspect', kind: 'repository_observation', verifier: 'qra_emerge_audit' }],
      activeAgents: ['nyx'],
      artifactReferences: [{ id: 'artifact-tree', path: 'evidence/tree.json' }],
    },
  });

  const restarted = createMissionStateService({ root, clock });
  const loaded = await restarted.get({ missionId: created.mission.id });

  assert.equal(loaded.revision, 2);
  assert.equal(running.revision, 2);
  assert.deepEqual(loaded.mission.goals, [{ id: 'goal-1', objective: 'Persist authoritative state' }]);
  assert.deepEqual(loaded.mission.subgoals.map(({ id }) => id), ['inspect', 'verify']);
  assert.deepEqual(loaded.mission.dependencies, [{ prerequisite: 'inspect', dependent: 'verify' }]);
  assert.deepEqual(loaded.mission.completedWork, ['inspect']);
  assert.deepEqual(loaded.mission.pendingWork, ['verify']);
  assert.deepEqual(loaded.mission.failedWork, []);
  assert.deepEqual(loaded.mission.evidence, [{ id: 'evidence-inspect', kind: 'repository_observation', verifier: 'qra_emerge_audit' }]);
  assert.deepEqual(loaded.mission.constraints, ['no model-authored completion']);
  assert.deepEqual(loaded.mission.permissions, [{ actor: 'nyx', actions: ['observe_repository'] }]);
  assert.deepEqual(loaded.mission.activeAgents, ['nyx']);
  assert.deepEqual(loaded.mission.artifactReferences, [{ id: 'artifact-tree', path: 'evidence/tree.json' }]);
  assert.deepEqual(loaded.mission.currentPlan, { id: 'plan-1', version: 1, steps: ['inspect', 'verify'] });
  assert.deepEqual(loaded.mission.environmentObservations, createInput().environmentObservations);
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
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx' },
      update: { modelOpinion: 'done' },
    }),
    /unsupported authoritative state field: modelOpinion/,
  );
  await assert.rejects(
    service.transition({
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
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx' },
      update: { completedWork: ['missing-subgoal'] },
    }),
    /work references unknown subgoal: missing-subgoal/,
  );
  await assert.rejects(
    service.transition({
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx' },
      update: { completedWork: ['inspect'], pendingWork: ['inspect', 'verify'] },
    }),
    /work partitions overlap: inspect/,
  );
  await assert.rejects(
    service.transition({
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx' },
      update: { activeAgents: ['unregistered-agent'] },
    }),
    /active agent lacks mission permission: unregistered-agent/,
  );
  await assert.rejects(
    service.transition({
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'unregistered-agent' },
      update: {},
    }),
    /transition actor lacks mission permission: unregistered-agent/,
  );
  await assert.rejects(
    service.transition({
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx' },
      update: { permissions: [{ actor: 'nyx', actions: ['certify_own_success'] }] },
    }),
    /unsupported authoritative state field: permissions/,
  );
});
