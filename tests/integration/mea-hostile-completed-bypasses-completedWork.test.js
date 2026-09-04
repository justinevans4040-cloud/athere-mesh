import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { writeProof } from '../../packages/proof/src/proof-store.js';

const clock = () => '2026-09-03T22:15:00.000Z';

function envelopeFor(record, operationId, agentId) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    objective: 'hostile completed bypass',
    createdAt: clock(),
  });
}

/**
 * Hostile RED (re-audit after claimed READY):
 * authorizeCompletedWorkClaim returns early when update omits completedWork.
 * A proof-gated completed signal can still publish status=completed with
 * empty completedWork / full pendingWork — bypassing the MEA success gate.
 * Acceptance dies if mission reaches status completed without going through
 * authorizeCompletedWorkClaim for the success claim.
 */
test('completed signal cannot bypass completedWork authorization gate', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-mea-hostile-completed-bypass-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create({
    operationId: 'op-mea-hostile-bypass-create-1',
    id: 'mission-mea-hostile-bypass-1',
    objective: 'Prove completed cannot skip completedWork gate',
    goals: [{ id: 'goal-1', objective: 'no completed bypass' }],
    subgoals: [
      { id: 'inspect', objective: 'Inspect', goalId: 'goal-1' },
      { id: 'verify', objective: 'Verify', goalId: 'goal-1' },
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
    currentPlan: { id: 'plan-mea-hostile-bypass-1', version: 1, steps: ['inspect', 'verify'] },
    environmentObservations: [{ source: 'runtime', key: 'hostile', value: true, observedAt: '2026-09-03T22:14:00.000Z' }],
  });

  const running = await service.transition({
    operationId: 'op-mea-hostile-bypass-running-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'executor evidence only' },
    update: {
      evidence: [{ agent: 'nyx', executor: 'repository-inspector', result: { ok: true } }],
      activeAgents: ['nyx'],
    },
    envelope: envelopeFor(created, 'op-mea-hostile-bypass-running-1', 'nyx'),
  });

  const proof = await writeProof({
    root,
    missionId: created.mission.id,
    operationId: 'op-mea-hostile-bypass-proof-1',
    payload: { result: 'hostile-completed-bypass' },
  });

  await assert.rejects(
    () => service.transition({
      operationId: 'op-mea-hostile-bypass-completed-1',
      missionId: created.mission.id,
      expectedRevision: running.revision,
      signal: {
        type: 'completed',
        agent: 'qra_emerge_audit',
        detail: 'completed without completedWork claim',
        proof: { ...proof, verified: true },
        // Object evidence also lists auditor — independence skipped when no completedWork key.
        evidence: { agent: 'qra_emerge_audit', result: { selfPerformed: true } },
      },
      update: {},
      envelope: envelopeFor(running, 'op-mea-hostile-bypass-completed-1', 'qra_emerge_audit'),
    }),
    /completedWork|certif|independen|success/i,
  );

  const after = await service.get({ missionId: created.mission.id });
  assert.notEqual(after.mission.status, 'completed');
  assert.deepEqual(after.mission.completedWork, []);
});
