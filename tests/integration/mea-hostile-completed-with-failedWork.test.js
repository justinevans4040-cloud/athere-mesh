import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { writeProof } from '../../packages/proof/src/proof-store.js';

const clock = () => '2026-09-03T23:35:00.000Z';

function envelopeFor(record, operationId, agentId) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    objective: 'hostile completed with failedWork',
    createdAt: clock(),
  });
}

/**
 * Hostile RED (third re-audit after Hole A/B READY claim):
 * assertCompletedSignalWorkCertified checks plan coverage + empty pendingWork
 * but ignores failedWork. A completed signal can publish mission success while
 * failedWork still holds subgoals — acceptance dies if status becomes completed
 * with non-empty failedWork.
 */
test('completed signal cannot publish success while failedWork remains non-empty', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-mea-hostile-failedWork-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create({
    operationId: 'op-mea-hostile-failedWork-create-1',
    id: 'mission-mea-hostile-failedWork-1',
    objective: 'Prove completed rejects leftover failedWork',
    goals: [{ id: 'goal-1', objective: 'no completed-with-failures' }],
    subgoals: [
      { id: 'inspect', objective: 'Inspect', goalId: 'goal-1' },
      { id: 'verify', objective: 'Verify', goalId: 'goal-1' },
      { id: 'extra', objective: 'Extra that failed', goalId: 'goal-1' },
    ],
    dependencies: [{ prerequisite: 'inspect', dependent: 'verify' }],
    constraints: [],
    permissions: [
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'rune', actions: ['execute_node_tests'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
      { actor: 'qra_recovery_driver', actions: ['block_interrupted_mission'] },
    ],
    currentPlan: { id: 'plan-mea-hostile-failedWork-1', version: 1, steps: ['inspect', 'verify'] },
    environmentObservations: [{ source: 'runtime', key: 'hostile', value: true, observedAt: '2026-09-03T23:34:00.000Z' }],
  });

  const running = await service.transition({
    operationId: 'op-mea-hostile-failedWork-nyx-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'executor evidence only' },
    update: {
      evidence: [{ agent: 'nyx', executor: 'repository-inspector', result: { ok: true } }],
      activeAgents: ['nyx'],
    },
    envelope: envelopeFor(created, 'op-mea-hostile-failedWork-nyx-1', 'nyx'),
  });

  const proof = await writeProof({
    root,
    missionId: created.mission.id,
    operationId: 'op-mea-hostile-failedWork-proof-1',
    payload: { result: 'hostile-completed-with-failedWork' },
  });

  await assert.rejects(
    () => service.transition({
      operationId: 'op-mea-hostile-failedWork-completed-1',
      missionId: created.mission.id,
      expectedRevision: running.revision,
      signal: {
        type: 'completed',
        agent: 'qra_emerge_audit',
        detail: 'completed covering plan while failedWork non-empty',
        proof: { ...proof, verified: true },
      },
      update: {
        completedWork: ['inspect', 'verify'],
        pendingWork: [],
        failedWork: ['extra'],
      },
      envelope: envelopeFor(running, 'op-mea-hostile-failedWork-completed-1', 'qra_emerge_audit'),
    }),
    /failedWork|fail/i,
  );

  const after = await service.get({ missionId: created.mission.id });
  assert.notEqual(after.mission.status, 'completed');
});
