import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

const clock = () => '2026-09-04T00:22:00.000Z';
const AUDITOR = 'qra_emerge_audit';

function envelopeFor(record, operationId, agentId) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    objective: 'verifier strings in evidence are not an identity source',
    createdAt: clock(),
  });
}

async function createHostileMission(tag) {
  const root = await mkdtemp(path.join(tmpdir(), `athere-mea-hostile-verifier-${tag}-`));
  const service = createMissionStateService({ root, clock });
  const created = await service.create({
    operationId: `op-mea-hostile-verifier-${tag}-create`,
    id: `mission-mea-hostile-verifier-${tag}`,
    objective: 'Prove verifier identity strings in evidence cannot decide authority',
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
    currentPlan: { id: `plan-mea-hostile-verifier-${tag}`, version: 1, steps: ['inspect', 'verify'] },
    environmentObservations: [{ source: 'runtime', key: 'hostile', value: true, observedAt: '2026-09-04T00:21:00.000Z' }],
  });
  return { service, created };
}

/**
 * KEPT as a real acceptance requirement, restated structurally.
 *
 * The rejection is caused by the auditor writing work evidence into authoritative state in
 * the same transition that advances completedWork — not by the `verifier` string naming it.
 * Item 6 provenance depends on verifier identity being recordable in artifact lineage, so
 * treating that word as a self-certification signal was always the wrong boundary.
 */
test('auditor cannot write update.evidence and certify in one transition (verifier string is incidental)', async () => {
  const { service, created } = await createHostileMission('update-verifier');

  await assert.rejects(
    () => service.transition({
      operationId: 'op-mea-hostile-verifier-update-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: AUDITOR, detail: 'update evidence written while certifying' },
      update: {
        completedWork: ['inspect'],
        pendingWork: ['verify'],
        evidence: [{ verifier: AUDITOR, performedAndCertified: true }],
      },
      envelope: envelopeFor(created, 'op-mea-hostile-verifier-update-1', AUDITOR),
    }),
    /cannot certify success for work it also performed/,
  );

  assert.deepEqual((await service.get({ missionId: created.mission.id })).mission.completedWork, []);
});

/**
 * Structural replacement for the former `signal.evidence.verifier` scrape probe.
 *
 * A verifier name inside a caller payload decides nothing in either direction.
 */
test('signal.evidence.verifier is not an identity source; recorded-actor rule still rejects', async () => {
  const hostileSignal = {
    type: 'running',
    agent: AUDITOR,
    detail: 'signal.evidence.verifier names the auditor',
    evidence: { verifier: AUDITOR, performedAndCertified: true },
  };
  const certification = { completedWork: ['inspect'], pendingWork: ['verify'] };

  const permitted = await createHostileMission('signal-verifier-payload-irrelevant');
  const performed = await permitted.service.transition({
    operationId: 'op-mea-hostile-verifier-signal-payload-irrelevant-perform',
    missionId: permitted.created.mission.id,
    expectedRevision: permitted.created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'executor performs recorded work' },
    update: { evidence: [{ id: 'evidence-inspect', kind: 'repository_observation' }] },
    envelope: envelopeFor(permitted.created, 'op-mea-hostile-verifier-signal-payload-irrelevant-perform', 'nyx'),
  });
  const certified = await permitted.service.transition({
    operationId: 'op-mea-hostile-verifier-signal-payload-irrelevant-cert',
    missionId: permitted.created.mission.id,
    expectedRevision: performed.revision,
    signal: hostileSignal,
    update: certification,
    envelope: envelopeFor(performed, 'op-mea-hostile-verifier-signal-payload-irrelevant-cert', AUDITOR),
  });
  assert.deepEqual(certified.mission.completedWork, ['inspect']);

  const genuine = await createHostileMission('signal-verifier-recorded-actor');
  const selfPerformed = await genuine.service.transition({
    operationId: 'op-mea-hostile-verifier-signal-recorded-actor-perform',
    missionId: genuine.created.mission.id,
    expectedRevision: genuine.created.revision,
    signal: { type: 'running', agent: AUDITOR, detail: 'auditor performs recorded work' },
    update: { evidence: [{ id: 'evidence-inspect', kind: 'repository_observation' }] },
    envelope: envelopeFor(genuine.created, 'op-mea-hostile-verifier-signal-recorded-actor-perform', AUDITOR),
  });
  await assert.rejects(
    () => genuine.service.transition({
      operationId: 'op-mea-hostile-verifier-signal-recorded-actor-cert',
      missionId: genuine.created.mission.id,
      expectedRevision: selfPerformed.revision,
      signal: hostileSignal,
      update: certification,
      envelope: envelopeFor(selfPerformed, 'op-mea-hostile-verifier-signal-recorded-actor-cert', AUDITOR),
    }),
    /cannot certify success for work it also performed/,
  );
  assert.deepEqual((await genuine.service.get({ missionId: genuine.created.mission.id })).mission.completedWork, []);
});
