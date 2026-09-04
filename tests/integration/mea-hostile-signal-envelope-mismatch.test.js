import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

const clock = () => '2026-09-03T21:20:00.000Z';

/**
 * Hostile RED: envelope.agent_id (executor) must not be able to advance
 * completedWork by forging signal.agent as the auditor.
 * Acceptance dies if this transition succeeds.
 */
test('executor cannot forge auditor signal.agent to advance completedWork', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-mea-hostile-mismatch-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create({
    operationId: 'op-mea-hostile-create-1',
    id: 'mission-mea-hostile-mismatch-1',
    objective: 'Prove signal/envelope agent binding on completedWork',
    goals: [{ id: 'goal-1', objective: 'no forged certification' }],
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
    currentPlan: { id: 'plan-mea-hostile-1', version: 1, steps: ['inspect', 'verify'] },
    environmentObservations: [{ source: 'runtime', key: 'hostile', value: true, observedAt: '2026-09-03T21:19:00.000Z' }],
  });

  const envelope = createAgentOperationEnvelope({
    record: created,
    operationId: 'op-mea-hostile-forge-1',
    agentId: 'nyx',
    objective: 'executor forges auditor identity on signal',
    createdAt: clock(),
  });

  await assert.rejects(
    () => service.transition({
      operationId: 'op-mea-hostile-forge-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: {
        type: 'running',
        agent: 'qra_emerge_audit',
        detail: 'forged auditor signal agent with executor envelope',
      },
      update: { completedWork: ['inspect'], pendingWork: ['verify'] },
      envelope,
    }),
    /auditor|completedWork|signal|envelope|agent/i,
  );

  const after = await service.get({ missionId: created.mission.id });
  assert.deepEqual(after.mission.completedWork, []);
});
