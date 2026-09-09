import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { createPostgresMissionStateStore } from '../../packages/postgres/src/postgres-mission-state-store.js';

const clock = () => '2026-09-09T04:10:00.000Z';

let PGlite;
try {
  ({ PGlite } = await import('@electric-sql/pglite'));
} catch (error) {
  PGlite = null;
}
const skipPglite = PGlite ? false : '@electric-sql/pglite is not installed in this environment';

function createInput(id) {
  return {
    operationId: `op-create-${id}`,
    id,
    objective: 'Share current job pointer on Postgres',
    goals: [{ id: 'goal-1', objective: 'Persist pointer' }],
    subgoals: [{ id: 'inspect-repository', objective: 'Inspect', goalId: 'goal-1' }],
    dependencies: [],
    constraints: [],
    permissions: [
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
    ],
    currentPlan: { id: 'titan-test-plan', version: 1, steps: ['inspect-repository'] },
    environmentObservations: [{ source: 'runtime', key: 'k', value: true, observedAt: clock() }],
  };
}

test('Postgres current-job pointer uses the same CAS as mission snapshots', { skip: skipPglite }, async () => {
  const db = new PGlite();
  const store = await createPostgresMissionStateStore({ db });
  const service = createMissionStateService({
    root: '/shared-state-unused-by-postgres',
    clock,
    store,
  });
  const missionId = `mission-pg-pointer-${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  const created = await service.create(createInput(missionId));
  const pointer = await service.setCurrentJobPointer({
    jobId: created.mission.id,
    missionRevision: created.revision,
    expectedRevision: 0,
    actor: 'titan',
    operationId: `${created.mission.id}-current-job`,
  });
  assert.equal(pointer.revision, 1);
  const other = createMissionStateService({
    root: '/shared-state-unused-by-postgres',
    clock,
    store,
  });
  const loaded = await other.loadCurrentJobPointer();
  assert.equal(loaded.pointer.jobId, missionId);
  await assert.rejects(
    () => other.setCurrentJobPointer({
      jobId: 'mission-split-brain',
      missionRevision: 1,
      expectedRevision: 0,
      actor: 'titan',
      operationId: 'op-split',
    }),
    /revision conflict/,
  );
  const admitted = await other.admitWork({});
  assert.equal(admitted.record.mission.id, missionId);
  await db.close();
});
