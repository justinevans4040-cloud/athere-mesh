import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

const clock = () => '2026-09-04T00:12:00.000Z';
const AUDITOR = 'qra_emerge_audit';

function envelopeFor(record, operationId, agentId) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    objective: 'double-wrapped evidence payload is not an identity source',
    createdAt: clock(),
  });
}

async function createHostileMission(tag) {
  const root = await mkdtemp(path.join(tmpdir(), `athere-mea-hostile-evidence-wrap-${tag}-`));
  const service = createMissionStateService({ root, clock });
  const created = await service.create({
    operationId: `op-mea-hostile-evidence-wrap-${tag}-create`,
    id: `mission-mea-hostile-evidence-wrap-${tag}`,
    objective: 'Prove wrap depth in evidence payloads cannot decide certification authority',
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
    currentPlan: { id: `plan-mea-hostile-evidence-wrap-${tag}`, version: 1, steps: ['inspect', 'verify'] },
    environmentObservations: [{ source: 'runtime', key: 'hostile', value: true, observedAt: '2026-09-04T00:11:00.000Z' }],
  });
  return { service, created };
}

async function recordWorkEvidence({ service, record, tag, agentId }) {
  const operationId = `op-mea-hostile-evidence-wrap-${tag}-perform`;
  return service.transition({
    operationId,
    missionId: record.mission.id,
    expectedRevision: record.revision,
    signal: { type: 'running', agent: agentId, detail: `${agentId} records work evidence` },
    update: { evidence: [{ id: 'evidence-inspect', kind: 'repository_observation' }] },
    envelope: envelopeFor(record, operationId, agentId),
  });
}

/**
 * Structural replacement for the former `evidence.evidence` wrap probe.
 *
 * Wrap depth used to matter because a bounded walk could be out-nested. Nothing walks the
 * payload now, so depth is meaningless in both directions: it cannot block an independent
 * auditor and it cannot rescue a recorded performer.
 */
test('signal.evidence.evidence.agent wrap is not an identity source; recorded-actor rule still rejects', async () => {
  const hostileSignal = {
    type: 'running',
    agent: AUDITOR,
    detail: 'double-wrapped evidence names the auditor as performer',
    evidence: { evidence: { agent: AUDITOR, performedAndCertified: true } },
  };
  const certification = { completedWork: ['inspect'], pendingWork: ['verify'] };

  const permitted = await createHostileMission('signal-wrap-payload-irrelevant');
  const performed = await recordWorkEvidence({
    service: permitted.service, record: permitted.created, tag: 'signal-wrap-payload-irrelevant', agentId: 'nyx',
  });
  const certified = await permitted.service.transition({
    operationId: 'op-mea-hostile-evidence-wrap-signal-payload-irrelevant-cert',
    missionId: permitted.created.mission.id,
    expectedRevision: performed.revision,
    signal: hostileSignal,
    update: certification,
    envelope: envelopeFor(performed, 'op-mea-hostile-evidence-wrap-signal-payload-irrelevant-cert', AUDITOR),
  });
  assert.deepEqual(certified.mission.completedWork, ['inspect']);

  const genuine = await createHostileMission('signal-wrap-recorded-actor');
  const selfPerformed = await recordWorkEvidence({
    service: genuine.service, record: genuine.created, tag: 'signal-wrap-recorded-actor', agentId: AUDITOR,
  });
  await assert.rejects(
    () => genuine.service.transition({
      operationId: 'op-mea-hostile-evidence-wrap-signal-recorded-actor-cert',
      missionId: genuine.created.mission.id,
      expectedRevision: selfPerformed.revision,
      signal: hostileSignal,
      update: certification,
      envelope: envelopeFor(selfPerformed, 'op-mea-hostile-evidence-wrap-signal-recorded-actor-cert', AUDITOR),
    }),
    /cannot certify success for work it also performed/,
  );
  assert.deepEqual((await genuine.service.get({ missionId: genuine.created.mission.id })).mission.completedWork, []);
});

/**
 * KEPT as a real acceptance requirement: writing work evidence into authoritative state
 * while advancing completedWork is perform-and-certify in one transition. The wrap shape
 * is incidental — the write is what is rejected.
 */
test('auditor cannot write update.evidence and certify in one transition (wrap shape is incidental)', async () => {
  const { service, created } = await createHostileMission('update-wrap');

  await assert.rejects(
    () => service.transition({
      operationId: 'op-mea-hostile-evidence-wrap-update-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: AUDITOR, detail: 'update evidence written while certifying' },
      update: {
        completedWork: ['inspect'],
        pendingWork: ['verify'],
        evidence: [{ evidence: { agent: AUDITOR, performedAndCertified: true } }],
      },
      envelope: envelopeFor(created, 'op-mea-hostile-evidence-wrap-update-1', AUDITOR),
    }),
    /cannot certify success for work it also performed/,
  );

  assert.deepEqual((await service.get({ missionId: created.mission.id })).mission.completedWork, []);
});
