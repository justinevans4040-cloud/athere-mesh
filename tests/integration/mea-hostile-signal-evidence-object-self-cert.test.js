import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

const clock = () => '2026-09-03T22:40:00.000Z';
const AUDITOR = 'qra_emerge_audit';

function envelopeFor(record, operationId, agentId) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    objective: 'object signal.evidence is not an identity source',
    createdAt: clock(),
  });
}

async function createHostileMission(tag) {
  const root = await mkdtemp(path.join(tmpdir(), `athere-mea-hostile-sig-obj-${tag}-`));
  const service = createMissionStateService({ root, clock });
  const created = await service.create({
    operationId: `op-mea-hostile-sig-obj-${tag}-create`,
    id: `mission-mea-hostile-sig-obj-${tag}`,
    objective: 'Prove object-shaped signal.evidence content cannot decide authority',
    goals: [{ id: 'goal-1', objective: 'structural independence' }],
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
    currentPlan: { id: `plan-mea-hostile-sig-obj-${tag}`, version: 1, steps: ['inspect', 'verify'] },
    environmentObservations: [{ source: 'runtime', key: 'hostile', value: true, observedAt: '2026-09-03T22:39:00.000Z' }],
  });
  return { service, created };
}

/**
 * Replaces a former string-scrape probe.
 *
 * `signal.evidence` is a per-transition ledger annotation; it never becomes authoritative
 * mission state, so its contents are not an identity source. What does count is the
 * service-recorded fact of who wrote work evidence into authoritative state. Both halves
 * are asserted here: the object-shaped payload does not block an independent auditor, and
 * it does not rescue an auditor that is itself a recorded performer.
 */
test('object-shaped signal.evidence is not an identity source; recorded-actor rule still rejects', async () => {
  const hostileSignal = {
    type: 'running',
    agent: AUDITOR,
    detail: 'object-shaped signal evidence names the auditor as performer',
    // Canonical mission signal shape is object, not array.
    evidence: { agent: AUDITOR, result: { performedAndCertified: true } },
  };
  const certification = { completedWork: ['inspect'], pendingWork: ['verify'] };

  const permitted = await createHostileMission('payload-irrelevant');
  const performed = await permitted.service.transition({
    operationId: 'op-mea-hostile-sig-obj-payload-irrelevant-perform',
    missionId: permitted.created.mission.id,
    expectedRevision: permitted.created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'executor performs recorded work' },
    update: { evidence: [{ id: 'evidence-inspect', kind: 'repository_observation' }] },
    envelope: envelopeFor(permitted.created, 'op-mea-hostile-sig-obj-payload-irrelevant-perform', 'nyx'),
  });
  const certified = await permitted.service.transition({
    operationId: 'op-mea-hostile-sig-obj-payload-irrelevant-cert',
    missionId: permitted.created.mission.id,
    expectedRevision: performed.revision,
    signal: hostileSignal,
    update: certification,
    envelope: envelopeFor(performed, 'op-mea-hostile-sig-obj-payload-irrelevant-cert', AUDITOR),
  });
  assert.deepEqual(certified.mission.completedWork, ['inspect']);

  const genuine = await createHostileMission('recorded-actor');
  const selfPerformed = await genuine.service.transition({
    operationId: 'op-mea-hostile-sig-obj-recorded-actor-perform',
    missionId: genuine.created.mission.id,
    expectedRevision: genuine.created.revision,
    signal: { type: 'running', agent: AUDITOR, detail: 'auditor performs recorded work' },
    update: { evidence: [{ id: 'evidence-inspect', kind: 'repository_observation' }] },
    envelope: envelopeFor(genuine.created, 'op-mea-hostile-sig-obj-recorded-actor-perform', AUDITOR),
  });
  await assert.rejects(
    () => genuine.service.transition({
      operationId: 'op-mea-hostile-sig-obj-recorded-actor-cert',
      missionId: genuine.created.mission.id,
      expectedRevision: selfPerformed.revision,
      signal: hostileSignal,
      update: certification,
      envelope: envelopeFor(selfPerformed, 'op-mea-hostile-sig-obj-recorded-actor-cert', AUDITOR),
    }),
    /cannot certify success for work it also performed/,
  );
  assert.deepEqual((await genuine.service.get({ missionId: genuine.created.mission.id })).mission.completedWork, []);
});
