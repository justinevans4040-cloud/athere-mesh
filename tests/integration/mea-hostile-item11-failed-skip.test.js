import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import {
  assessMissionPath,
  buildWorkflowGraph,
} from '../../packages/contracts/src/workflow-graph.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

/**
 * Item 11 hole: plan-order treated failed earlier steps as "satisfied", so
 * completing a later step could skip still-incomplete earlier work
 * (fail b → complete c while a never ran).
 */
test('HOLE: failed intermediate must not waive plan-order for earlier incomplete steps', () => {
  const graph = buildWorkflowGraph({
    goals: [{ id: 'g1', objective: 'g' }],
    subgoals: [
      { id: 'a', goalId: 'g1', objective: 'a' },
      { id: 'b', goalId: 'g1', objective: 'b' },
      { id: 'c', goalId: 'g1', objective: 'c' },
    ],
    dependencies: [],
    currentPlan: { id: 'p1', version: 1, steps: ['a', 'b', 'c'] },
  });

  const skipA = assessMissionPath({
    workflowGraph: graph,
    completedWork: ['c'],
    pendingWork: ['a'],
    failedWork: ['b'],
  });
  assert.equal(
    skipA.valid,
    false,
    `HOLE: fail-b complete-c skipped incomplete a. reason=${skipA.reason}`,
  );
  assert.match(skipA.reason, /plan_order:c->skips:a/);

  const failACompleteB = assessMissionPath({
    workflowGraph: graph,
    completedWork: ['b'],
    pendingWork: ['c'],
    failedWork: ['a'],
  });
  assert.equal(
    failACompleteB.valid,
    false,
    `HOLE: fail-a complete-b without recovery/alternate. reason=${failACompleteB.reason}`,
  );
  assert.match(failACompleteB.reason, /plan_order:b->skips:a/);
});

test('service rejects completedWork that skips earlier steps via failed intermediate', async () => {
  const clock = () => '2026-09-05T16:00:00.000Z';
  const root = await mkdtemp(path.join(tmpdir(), 'athere-item11-fail-skip-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create({
    operationId: 'op-i11-fail-create',
    id: 'mission-i11-fail-skip-1',
    objective: 'fail-skip probe',
    goals: [{ id: 'g1', objective: 'g' }],
    subgoals: [
      { id: 'a', goalId: 'g1', objective: 'a' },
      { id: 'b', goalId: 'g1', objective: 'b' },
      { id: 'c', goalId: 'g1', objective: 'c' },
    ],
    dependencies: [],
    constraints: [],
    permissions: [
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
    ],
    currentPlan: { id: 'p1', version: 1, steps: ['a', 'b', 'c'] },
    environmentObservations: [],
  });
  const performed = await service.transition({
    operationId: 'op-i11-fail-nyx',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'work' },
    update: { evidence: [{ agent: 'nyx', note: 'x' }], activeAgents: ['nyx'] },
    envelope: createAgentOperationEnvelope({
      record: created,
      operationId: 'op-i11-fail-nyx',
      agentId: 'nyx',
      objective: 'item11',
      createdAt: clock(),
    }),
  });
  await assert.rejects(
    () => service.transition({
      operationId: 'op-i11-fail-cert',
      missionId: created.mission.id,
      expectedRevision: performed.revision,
      signal: { type: 'running', agent: 'qra_emerge_audit', detail: 'bad path' },
      update: {
        completedWork: ['c'],
        pendingWork: ['a'],
        failedWork: ['b'],
      },
      envelope: createAgentOperationEnvelope({
        record: performed,
        operationId: 'op-i11-fail-cert',
        agentId: 'qra_emerge_audit',
        objective: 'item11',
        createdAt: clock(),
      }),
    }),
    /mission path invalid/,
  );
});
