import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

const clock = () => '2026-09-04T19:20:00.000Z';
const AUDITOR = 'qra_emerge_audit';

/** Latin small letter script g (U+0261). */
const SCRIPT_G_AUDITOR = `qra_emer${String.fromCodePoint(0x0261)}e_audit`;
/** Komi De (U+0501) as Latin d stand-in. */
const KOMI_D_AUDITOR = `qra_emerge_au${String.fromCodePoint(0x0501)}it`;
/** Greek iota (U+03B9) as Latin i stand-in. */
const GREEK_IOTA_AUDITOR = `qra_emerge_aud${String.fromCodePoint(0x03B9)}t`;

function envelopeFor(record, operationId, agentId) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    objective: 'seventh re-audit channels are not identity sources',
    createdAt: clock(),
  });
}

async function createHostileMission(tag) {
  const root = await mkdtemp(path.join(tmpdir(), `athere-mea-hostile-seventh-${tag}-`));
  const service = createMissionStateService({ root, clock });
  const created = await service.create({
    operationId: `op-mea-hostile-seventh-${tag}-create`,
    id: `mission-mea-hostile-seventh-${tag}`,
    objective: 'Prove seventh-re-audit payload channels cannot decide certification authority',
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
    currentPlan: { id: `plan-mea-hostile-seventh-${tag}`, version: 1, steps: ['inspect', 'verify'] },
    environmentObservations: [{ source: 'runtime', key: 'hostile', value: true, observedAt: '2026-09-04T19:19:00.000Z' }],
  });
  return { service, created };
}

async function recordWorkEvidence({ service, record, tag, agentId }) {
  const operationId = `op-mea-hostile-seventh-${tag}-perform`;
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
 * Structural replacement for the seventh-re-audit string-scrape probes.
 *
 * This round is the clearest evidence that scraping caller payloads was the wrong
 * boundary: every probe here (lookalikes outside a hand-rolled map, arbitrary nest depth,
 * substring embedding, base64 and percent encoding, character and code-point arrays,
 * and mutation fields the call site had not thought to pass in) was a NEW encoding of the
 * same string. The attacker owned the haystack, so the list could never be finished.
 *
 * Independence is now decided from the mission's own hash-chained `transitionHistory`:
 * the authorized envelope agent is compared against the recorded actors of transitions
 * that wrote work evidence into authoritative state. Payload encodings are therefore
 * asserted in both directions — they cannot block an independent auditor, and they cannot
 * rescue an auditor that is a recorded performer.
 */
async function expectPayloadIrrelevantAndRecordedActorRejects({ tag, signal, update }) {
  const certification = { completedWork: ['inspect'], pendingWork: ['verify'], ...update };
  const hostileSignal = { type: 'running', agent: AUDITOR, detail: `structural probe ${tag}`, ...signal };

  const permitted = await createHostileMission(`${tag}-payload-irrelevant`);
  const performed = await recordWorkEvidence({
    service: permitted.service, record: permitted.created, tag: `${tag}-payload-irrelevant`, agentId: 'nyx',
  });
  const certifyOperation = `op-mea-hostile-seventh-${tag}-payload-irrelevant-cert`;
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
  const selfCertifyOperation = `op-mea-hostile-seventh-${tag}-recorded-actor-cert`;
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

test('H1 combining-mark payloads are not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'h1-regression',
    signal: { result: { agent: 'q\u0308ra_emerge_audit', performedAndCertified: true } },
  });
});

test('H3 Cyrillic-lookalike payloads are not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'h3-regression',
    signal: { result: { agent: 'qr\u0430_emerge_audit', performedAndCertified: true } },
  });
});

test('H6 agent_id payloads are not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'h6-regression',
    signal: { result: { agent_id: AUDITOR, performedAndCertified: true } },
  });
});

test('Latin script-g lookalike (U+0261) payloads are not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'lookalike-script-g',
    signal: { result: { agent: SCRIPT_G_AUDITOR, performedAndCertified: true } },
  });
});

test('Komi-De lookalike (U+0501) payloads are not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'lookalike-komi-d',
    signal: { result: { agent: KOMI_D_AUDITOR, performedAndCertified: true } },
  });
});

test('Greek-iota lookalike (U+03B9) payloads are not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'lookalike-greek-iota',
    signal: { result: { agent: GREEK_IOTA_AUDITOR, performedAndCertified: true } },
  });
});

test('deep nesting in payloads is not an identity source', async () => {
  let nest = AUDITOR;
  for (let i = 0; i < 40; i += 1) nest = { wrap: nest };
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'depth-40-nest',
    signal: { result: nest },
  });
});

test('substring-embedded ids in payloads are not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'substring-prefix-suffix',
    signal: { result: { note: `prefix-${AUDITOR}-suffix`, performedAndCertified: true } },
  });
});

test('path-style substrings in payloads are not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'substring-path',
    signal: { result: { ref: `${AUDITOR}/verify`, performedAndCertified: true } },
  });
});

test('JSON-stringified blobs in payloads are not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'substring-json-blob',
    signal: {
      result: {
        blob: JSON.stringify({ performer: AUDITOR, action: 'observe_repository' }),
        performedAndCertified: true,
      },
    },
  });
});

test('base64-encoded ids in payloads are not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'base64-leaf',
    signal: { result: { agent: Buffer.from(AUDITOR, 'utf8').toString('base64'), performedAndCertified: true } },
  });
});

test('URI-percent-encoded ids in payloads are not an identity source', async () => {
  const encoded = [...AUDITOR].map((ch) => `%${ch.charCodeAt(0).toString(16).padStart(2, '0')}`).join('');
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'uri-encoded-leaf',
    signal: { result: { agent: encoded, performedAndCertified: true } },
  });
});

test('char-array reconstituted ids in payloads are not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'char-array',
    signal: { result: { agent: [...AUDITOR], performedAndCertified: true } },
  });
});

test('codepoint-array reconstituted ids in payloads are not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'codepoint-array',
    signal: { result: { agent: [...AUDITOR].map((ch) => ch.charCodeAt(0)), performedAndCertified: true } },
  });
});

/**
 * `artifactReferences` carries Item 6 provenance — artifact hash, producer agent/action,
 * and verifier decision. Treating the certifier's name there as a self-certification
 * signal is what forced that provenance to be stripped, damaging Item 6. It is caller
 * content and is not an identity source.
 */
test('update.artifactReferences[].agent is not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'artifactReferences-agent',
    signal: { result: { agentEvidence: [{ agent: 'nyx' }, { agent: 'rune' }] } },
    update: {
      completedWork: ['inspect'],
      pendingWork: ['verify'],
      artifactReferences: [{ agent: AUDITOR, verifier: AUDITOR, ref: 'mission-proof', kind: 'evidence' }],
    },
  });
});

test('update.activeAgents membership is not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'activeAgents-auditor',
    signal: { result: { agentEvidence: [{ agent: 'nyx' }, { agent: 'rune' }] } },
    update: {
      completedWork: ['inspect'],
      pendingWork: ['verify'],
      activeAgents: [AUDITOR],
    },
  });
});

/**
 * Honest path must still ACCEPT with nyx/rune only.
 */
test('auditor may certify when signal.result.agentEvidence lists only nyx/rune', async () => {
  const { service, created } = await createHostileMission('honest-array');

  const transitioned = await service.transition({
    operationId: 'op-mea-hostile-seventh-honest-array-1',
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
    envelope: envelopeFor(created, 'op-mea-hostile-seventh-honest-array-1', AUDITOR),
  });

  assert.deepEqual(transitioned.mission.completedWork, ['inspect']);
});
