import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

const clock = () => '2026-09-03T23:30:00.000Z';
const AUDITOR = 'qra_emerge_audit';

function envelopeFor(record, operationId, agentId) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    objective: 'nested evidence payload is not an identity source',
    createdAt: clock(),
  });
}

async function createHostileMission(tag) {
  const root = await mkdtemp(path.join(tmpdir(), `athere-mea-hostile-nested-${tag}-`));
  const service = createMissionStateService({ root, clock });
  const created = await service.create({
    operationId: `op-mea-hostile-nested-${tag}-create`,
    id: `mission-mea-hostile-nested-${tag}`,
    objective: 'Prove nested evidence content cannot decide certification authority',
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
    currentPlan: { id: `plan-mea-hostile-nested-${tag}`, version: 1, steps: ['inspect', 'verify'] },
    environmentObservations: [{ source: 'runtime', key: 'hostile', value: true, observedAt: '2026-09-03T23:29:00.000Z' }],
  });
  return { service, created };
}

async function recordWorkEvidence({ service, record, tag, agentId }) {
  const operationId = `op-mea-hostile-nested-${tag}-perform`;
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
 * Structural replacement for the former nested `signal.evidence` string-scrape probes.
 *
 * `signal.evidence` is a per-transition ledger annotation and never becomes authoritative
 * state, so nesting an agent id inside it proves nothing either way. Each former channel is
 * asserted in both directions: the payload does not block an independent auditor, and it
 * does not rescue an auditor that is the recorded `actor` of a performance transition.
 */
async function expectPayloadIrrelevantAndRecordedActorRejects({ tag, signal, update }) {
  const certification = { completedWork: ['inspect'], pendingWork: ['verify'], ...update };
  const hostileSignal = { type: 'running', agent: AUDITOR, detail: `structural probe ${tag}`, ...signal };

  const permitted = await createHostileMission(`${tag}-payload-irrelevant`);
  const performed = await recordWorkEvidence({
    service: permitted.service, record: permitted.created, tag: `${tag}-payload-irrelevant`, agentId: 'nyx',
  });
  const certifyOperation = `op-mea-hostile-nested-${tag}-payload-irrelevant-cert`;
  const certified = await permitted.service.transition({
    operationId: certifyOperation,
    missionId: permitted.created.mission.id,
    expectedRevision: performed.revision,
    signal: hostileSignal,
    update: certification,
    envelope: envelopeFor(performed, certifyOperation, AUDITOR),
  });
  assert.deepEqual(certified.mission.completedWork, ['inspect'], `payload must not decide authority for ${tag}`);

  const genuine = await createHostileMission(`${tag}-recorded-actor`);
  const selfPerformed = await recordWorkEvidence({
    service: genuine.service, record: genuine.created, tag: `${tag}-recorded-actor`, agentId: AUDITOR,
  });
  const selfCertifyOperation = `op-mea-hostile-nested-${tag}-recorded-actor-cert`;
  await assert.rejects(
    () => genuine.service.transition({
      operationId: selfCertifyOperation,
      missionId: genuine.created.mission.id,
      expectedRevision: selfPerformed.revision,
      signal: hostileSignal,
      update: certification,
      envelope: envelopeFor(selfPerformed, selfCertifyOperation, AUDITOR),
    }),
    /cannot certify success for work it also performed/,
    `expected recorded-actor REJECT for ${tag}`,
  );
  const after = await genuine.service.get({ missionId: genuine.created.mission.id });
  assert.deepEqual(after.mission.completedWork, [], `completedWork advanced via ${tag}`);
}

test('nested signal.evidence.result.agent is not an identity source; recorded-actor rule still rejects', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'result-agent',
    signal: { evidence: { result: { agent: AUDITOR, performedAndCertified: true } } },
  });
});

test('signal.evidence.executor is not an identity source; recorded-actor rule still rejects', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'executor',
    signal: { evidence: { executor: AUDITOR, result: { performedAndCertified: true } } },
  });
});

test('signal.evidence.agents array is not an identity source; recorded-actor rule still rejects', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'agents',
    signal: { evidence: { agents: [AUDITOR], result: { performedAndCertified: true } } },
  });
});

/**
 * KEPT as a real acceptance requirement, on structural grounds rather than content.
 *
 * Writing work evidence into authoritative mission state is what makes an agent a
 * recorded performer. Doing that in the very transition that advances completedWork is
 * perform-and-certify in one act, and is rejected from the validated update itself —
 * the nested identity strings below are decoration and are never inspected.
 */
test('auditor cannot write update.evidence and certify in one transition (nested identity is incidental)', async () => {
  const { service, created } = await createHostileMission('update-nested');

  await assert.rejects(
    () => service.transition({
      operationId: 'op-mea-hostile-nested-update-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: AUDITOR, detail: 'update evidence written while certifying' },
      update: {
        completedWork: ['inspect'],
        pendingWork: ['verify'],
        evidence: [{ result: { agent: AUDITOR, performedAndCertified: true } }],
      },
      envelope: envelopeFor(created, 'op-mea-hostile-nested-update-1', AUDITOR),
    }),
    /cannot certify success for work it also performed/,
  );
  assert.deepEqual((await service.get({ missionId: created.mission.id })).mission.completedWork, []);

  // Same rejection with no identity string anywhere in the payload: the write is the signal.
  const anonymous = await createHostileMission('update-anonymous');
  await assert.rejects(
    () => anonymous.service.transition({
      operationId: 'op-mea-hostile-nested-update-anonymous-1',
      missionId: anonymous.created.mission.id,
      expectedRevision: anonymous.created.revision,
      signal: { type: 'running', agent: AUDITOR, detail: 'anonymous evidence written while certifying' },
      update: {
        completedWork: ['inspect'],
        pendingWork: ['verify'],
        evidence: [{ id: 'evidence-anonymous', kind: 'repository_observation' }],
      },
      envelope: envelopeFor(anonymous.created, 'op-mea-hostile-nested-update-anonymous-1', AUDITOR),
    }),
    /cannot certify success for work it also performed/,
  );
});
