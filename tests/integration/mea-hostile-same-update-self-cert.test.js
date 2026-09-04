import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

const clock = () => '2026-09-03T21:25:00.000Z';

/**
 * KEPT as a real acceptance requirement, on structural grounds.
 *
 * Writing work evidence into authoritative mission state is what makes an agent a
 * recorded performer, so doing it in the same transition that advances completedWork is
 * perform-and-certify in one act. The rejection comes from the evidence write in the
 * validated update; the identity strings inside the entry are never read.
 * Acceptance dies if this transition succeeds.
 */
test('auditor cannot perform and certify success in the same update', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-mea-hostile-same-update-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create({
    operationId: 'op-mea-hostile-same-create-1',
    id: 'mission-mea-hostile-same-1',
    objective: 'Prove same-update self-cert is rejected',
    goals: [{ id: 'goal-1', objective: 'no same-update self-cert' }],
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
    currentPlan: { id: 'plan-mea-hostile-same-1', version: 1, steps: ['inspect', 'verify'] },
    environmentObservations: [{ source: 'runtime', key: 'hostile', value: true, observedAt: '2026-09-03T21:24:00.000Z' }],
  });

  const envelope = createAgentOperationEnvelope({
    record: created,
    operationId: 'op-mea-hostile-same-cert-1',
    agentId: 'qra_emerge_audit',
    objective: 'auditor self-certs via same-update evidence',
    createdAt: clock(),
  });

  await assert.rejects(
    () => service.transition({
      operationId: 'op-mea-hostile-same-cert-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: {
        type: 'running',
        agent: 'qra_emerge_audit',
        detail: 'same-update perform and certify',
      },
      update: {
        completedWork: ['inspect'],
        pendingWork: ['verify'],
        evidence: [{
          agent: 'qra_emerge_audit',
          executor: 'proof-verifier',
          result: { performedAndCertified: true },
        }],
      },
      envelope,
    }),
    /cannot certify success for work it also performed/,
  );

  const after = await service.get({ missionId: created.mission.id });
  assert.deepEqual(after.mission.completedWork, []);
});
