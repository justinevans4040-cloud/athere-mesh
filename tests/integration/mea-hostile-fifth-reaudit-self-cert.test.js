import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

const clock = () => '2026-09-04T17:10:00.000Z';
const AUDITOR = 'qra_emerge_audit';

function envelopeFor(record, operationId, agentId) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    objective: 'fifth re-audit channels are not identity sources',
    createdAt: clock(),
  });
}

async function createHostileMission(tag) {
  const root = await mkdtemp(path.join(tmpdir(), `athere-mea-hostile-fifth-${tag}-`));
  const service = createMissionStateService({ root, clock });
  const created = await service.create({
    operationId: `op-mea-hostile-fifth-${tag}-create`,
    id: `mission-mea-hostile-fifth-${tag}`,
    objective: 'Prove fifth-re-audit payload channels cannot decide certification authority',
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
    currentPlan: { id: `plan-mea-hostile-fifth-${tag}`, version: 1, steps: ['inspect', 'verify'] },
    environmentObservations: [{ source: 'runtime', key: 'hostile', value: true, observedAt: '2026-09-04T17:09:00.000Z' }],
  });
  return { service, created };
}

async function recordWorkEvidence({ service, record, tag, agentId }) {
  const operationId = `op-mea-hostile-fifth-${tag}-perform`;
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
 * Structural replacement for the fifth-re-audit string-scrape probes.
 *
 * These cases originally probed a deep scrape of caller-supplied payloads for the
 * certifier's agent id — object bags, object maps, case variants, zero-width joins,
 * NFKC folds, and synonym keys. That approach let the attacker own the haystack and could
 * never be proven closed. Independence now compares service-recorded identities only, so
 * every one of these channels is asserted in both directions:
 *
 *   1. the payload does not influence authorization — NYX is the recorded performer, so
 *      the auditor certifies successfully however the payload names it;
 *   2. the same payload cannot rescue an auditor that IS the recorded `actor` of a
 *      performance transition.
 */
async function expectPayloadIrrelevantAndRecordedActorRejects({ tag, signal, update }) {
  const certification = { completedWork: ['inspect'], pendingWork: ['verify'], ...update };
  const hostileSignal = { type: 'running', agent: AUDITOR, detail: `structural probe ${tag}`, ...signal };

  const permitted = await createHostileMission(`${tag}-payload-irrelevant`);
  const performed = await recordWorkEvidence({
    service: permitted.service, record: permitted.created, tag: `${tag}-payload-irrelevant`, agentId: 'nyx',
  });
  const certifyOperation = `op-mea-hostile-fifth-${tag}-payload-irrelevant-cert`;
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
  const selfCertifyOperation = `op-mea-hostile-fifth-${tag}-recorded-actor-cert`;
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

test('object-shaped signal.result.agentEvidence is not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'object-agentEvidence',
    signal: { result: { agentEvidence: { agent: AUDITOR, performedAndCertified: true } } },
  });
});

test('object-shaped signal.result.agents is not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'object-agents',
    signal: { result: { agents: { agent: AUDITOR, performedAndCertified: true } } },
  });
});

test('case-variant performer ids in payloads are not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'case-variant',
    signal: { result: { agent: 'QRA_EMERGE_AUDIT', performedAndCertified: true } },
  });
});

test('zero-width-suffixed performer ids in payloads are not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'zwsp',
    signal: { result: { agent: 'qra_emerge_audit\u200b', performedAndCertified: true } },
  });
});

test('signal.result.agentEvidence[].author is not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'author-key',
    signal: { result: { agentEvidence: [{ author: AUDITOR, performedAndCertified: true }] } },
  });
});

test('signal.result workers / actors / by keys are not identity sources', async () => {
  for (const key of ['workers', 'actors', 'by']) {
    await expectPayloadIrrelevantAndRecordedActorRejects({
      tag: `result-${key}`,
      signal: { result: { [key]: AUDITOR, performedAndCertified: true } },
    });
  }
});

test('object-map signal.result.agentEvidence is not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'map-agentEvidence',
    signal: { result: { agentEvidence: { 0: { agent: AUDITOR, performedAndCertified: true } } } },
  });
});

test('signal.result.actors.lead string map is not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'actors-lead',
    signal: { result: { actors: { lead: AUDITOR }, performedAndCertified: true } },
  });
});

test('signal.evidence.by is not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'evidence-by',
    signal: { evidence: { by: AUDITOR, performedAndCertified: true } },
  });
});

test('NFKC-fullwidth performer ids in payloads are not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'nfkc-fullwidth',
    signal: { result: { agent: 'ｑｒａ＿ｅｍｅｒｇｅ＿ａｕｄｉｔ', performedAndCertified: true } },
  });
});

/**
 * Honest path still ACCEPT: nyx/rune array agentEvidence only.
 */
test('auditor may certify when signal.result.agentEvidence lists only nyx/rune', async () => {
  const { service, created } = await createHostileMission('honest-array');

  const transitioned = await service.transition({
    operationId: 'op-mea-hostile-fifth-honest-array-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: {
      type: 'running',
      agent: AUDITOR,
      detail: 'honest nyx/rune agentEvidence',
      result: {
        agentEvidence: [
          { agent: 'nyx', action: 'observe_repository' },
          { agent: 'rune', action: 'execute_node_tests' },
        ],
      },
    },
    update: {
      completedWork: ['inspect'],
      pendingWork: ['verify'],
    },
    envelope: envelopeFor(created, 'op-mea-hostile-fifth-honest-array-1', AUDITOR),
  });

  assert.deepEqual(transitioned.mission.completedWork, ['inspect']);
});
