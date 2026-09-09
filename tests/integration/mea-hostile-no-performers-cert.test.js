import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { authorizeCompletedWorkClaim } from '../../packages/contracts/src/execution-roles.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

const clock = () => '2026-09-05T14:00:00.000Z';

/**
 * Item 9 hole: auditor could advance completedWork on a create-only ledger
 * (zero recorded work performers). That is sole authority to declare success
 * without independent resulting reality — rubber-stamp vacuum.
 */
test('auditor cannot advance completedWork with zero recorded work performers', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-mea-no-performers-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create({
    operationId: 'op-mea-no-perf-create-1',
    id: 'mission-mea-no-perf-1',
    objective: 'Prove vacuum certification is rejected',
    goals: [{ id: 'goal-1', objective: 'no vacuum cert' }],
    subgoals: [
      { id: 'inspect', objective: 'Inspect', goalId: 'goal-1' },
      { id: 'verify', objective: 'Verify', goalId: 'goal-1' },
    ],
    dependencies: [{ prerequisite: 'inspect', dependent: 'verify' }],
    constraints: [],
    permissions: [
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
    ],
    currentPlan: { id: 'plan-mea-no-perf-1', version: 1, steps: ['inspect', 'verify'] },
    environmentObservations: [
      { source: 'runtime', key: 'hostile', value: true, observedAt: '2026-09-05T13:59:00.000Z' },
    ],
  });

  await assert.rejects(
    () => service.transition({
      operationId: 'op-mea-no-perf-cert-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: {
        type: 'running',
        agent: 'qra_emerge_audit',
        detail: 'vacuum certify without any executor work',
      },
      update: {
        completedWork: ['inspect'],
        pendingWork: ['verify'],
      },
      envelope: createAgentOperationEnvelope({
        record: created,
        operationId: 'op-mea-no-perf-cert-1',
        agentId: 'qra_emerge_audit',
        objective: 'vacuum certify',
        createdAt: clock(),
      }),
    }),
    /cannot certify success without recorded work performers/,
  );

  const after = await service.get({ missionId: created.mission.id });
  assert.deepEqual(after.mission.completedWork, []);
  assert.equal(after.revision, 1);
});

test('authorizeCompletedWorkClaim rejects create-only ledger with no performers', () => {
  const createOnly = [
    {
      actor: 'titan',
      action: 'create',
      changes: { evidence: { before: [], after: [] } },
    },
  ];
  assert.throws(
    () => authorizeCompletedWorkClaim({
      agentId: 'qra_emerge_audit',
      transitionHistory: createOnly,
      update: { completedWork: ['inspect'] },
    }),
    /cannot certify success without recorded work performers/,
  );
});
