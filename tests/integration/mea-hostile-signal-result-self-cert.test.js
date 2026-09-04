import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

const clock = () => '2026-09-04T00:10:00.000Z';
const AUDITOR = 'qra_emerge_audit';

function envelopeFor(record, operationId, agentId) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    objective: 'signal.result payload is not an identity source',
    createdAt: clock(),
  });
}

async function createHostileMission(tag) {
  const root = await mkdtemp(path.join(tmpdir(), `athere-mea-hostile-signal-result-${tag}-`));
  const service = createMissionStateService({ root, clock });
  const created = await service.create({
    operationId: `op-mea-hostile-signal-result-${tag}-create`,
    id: `mission-mea-hostile-signal-result-${tag}`,
    objective: 'Prove signal.result content never decides certification authority',
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
    currentPlan: { id: `plan-mea-hostile-signal-result-${tag}`, version: 1, steps: ['inspect', 'verify'] },
    environmentObservations: [{ source: 'runtime', key: 'hostile', value: true, observedAt: '2026-09-04T00:09:00.000Z' }],
  });
  return { service, created };
}

async function recordWorkEvidence({ service, record, tag, agentId }) {
  const operationId = `op-mea-hostile-signal-result-${tag}-perform`;
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
 * Structural replacement for the former `signal.result` string-scrape probes.
 *
 * Content-based identity is deliberately NOT a security boundary. Independence is
 * decided from the service-written transition ledger, so each former forge channel is
 * now asserted in both directions:
 *
 *   1. the payload does not influence authorization — NYX is the recorded performer, so
 *      the auditor certifies successfully no matter how the payload names the auditor;
 *   2. the same payload cannot rescue an auditor that IS the recorded `actor` of a
 *      performance transition — the structural rule still rejects.
 */
async function expectPayloadIrrelevantAndRecordedActorRejects({ tag, signal, update }) {
  const certification = { completedWork: ['inspect'], pendingWork: ['verify'], ...update };
  const hostileSignal = { type: 'running', agent: AUDITOR, detail: `structural probe ${tag}`, ...signal };

  const permitted = await createHostileMission(`${tag}-payload-irrelevant`);
  const performed = await recordWorkEvidence({
    service: permitted.service, record: permitted.created, tag: `${tag}-payload-irrelevant`, agentId: 'nyx',
  });
  const certifyOperation = `op-mea-hostile-signal-result-${tag}-payload-irrelevant-cert`;
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
  const selfCertifyOperation = `op-mea-hostile-signal-result-${tag}-recorded-actor-cert`;
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

test('signal.result.agent is not an identity source; recorded-actor rule still rejects', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'result-agent',
    signal: { result: { agent: AUDITOR, performedAndCertified: true } },
  });
});

test('signal.result.executor is not an identity source; recorded-actor rule still rejects', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'result-executor',
    signal: { result: { executor: AUDITOR, performedAndCertified: true } },
  });
});

test('signal.result.agentEvidence[].agent is not an identity source; recorded-actor rule still rejects', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'result-agentEvidence',
    signal: { result: { agentEvidence: [{ agent: AUDITOR, performedAndCertified: true }] } },
  });
});

test('signal.result.verifier is not an identity source; recorded-actor rule still rejects', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'result-verifier',
    signal: { result: { verifier: AUDITOR, performedAndCertified: true } },
  });
});
