import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

const clock = () => '2026-09-04T18:20:00.000Z';
const AUDITOR = 'qra_emerge_audit';
const COMBINING_MARK_AUDITOR = 'q\u0308ra_emerge_audit';

function envelopeFor(record, operationId, agentId) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    objective: 'sixth re-audit channels are not identity sources',
    createdAt: clock(),
  });
}

async function createHostileMission(tag) {
  const root = await mkdtemp(path.join(tmpdir(), `athere-mea-hostile-sixth-${tag}-`));
  const service = createMissionStateService({ root, clock });
  const created = await service.create({
    operationId: `op-mea-hostile-sixth-${tag}-create`,
    id: `mission-mea-hostile-sixth-${tag}`,
    objective: 'Prove sixth-re-audit payload channels cannot decide certification authority',
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
    currentPlan: { id: `plan-mea-hostile-sixth-${tag}`, version: 1, steps: ['inspect', 'verify'] },
    environmentObservations: [{ source: 'runtime', key: 'hostile', value: true, observedAt: '2026-09-04T18:19:00.000Z' }],
  });
  return { service, created };
}

async function recordWorkEvidence({ service, record, tag, agentId }) {
  const operationId = `op-mea-hostile-sixth-${tag}-perform`;
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
 * Structural replacement for the sixth-re-audit string-scrape probes.
 *
 * These originally probed combining marks, homoglyphs, synonym keys, and unbounded bag
 * names against a deep scrape of caller payloads. Unicode confusability is unbounded, so
 * that boundary could never be closed. Independence now compares service-recorded
 * identities from the transition ledger, and recorded ids come from the closed fleet
 * registry, so lookalike folding is not needed at all. Each channel is asserted in both
 * directions: it cannot block an independent auditor, and it cannot rescue a recorded
 * performer.
 */
async function expectPayloadIrrelevantAndRecordedActorRejects({ tag, signal, update }) {
  const certification = { completedWork: ['inspect'], pendingWork: ['verify'], ...update };
  const hostileSignal = { type: 'running', agent: AUDITOR, detail: `structural probe ${tag}`, ...signal };

  const permitted = await createHostileMission(`${tag}-payload-irrelevant`);
  const performed = await recordWorkEvidence({
    service: permitted.service, record: permitted.created, tag: `${tag}-payload-irrelevant`, agentId: 'nyx',
  });
  const certifyOperation = `op-mea-hostile-sixth-${tag}-payload-irrelevant-cert`;
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
  const selfCertifyOperation = `op-mea-hostile-sixth-${tag}-recorded-actor-cert`;
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

test('combining-mark performer ids in payloads are not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'combining-mark',
    signal: { result: { agent: COMBINING_MARK_AUDITOR, performedAndCertified: true } },
  });
});

test('English synonym identity keys in payloads are not identity sources', async () => {
  const synonyms = ['writer', 'operator', 'contributor', 'owner', 'createdBy', 'submittedBy', 'signedBy', 'principal'];
  for (const key of synonyms) {
    await expectPayloadIrrelevantAndRecordedActorRejects({
      tag: `synonym-${key}`,
      signal: { result: { [key]: AUDITOR, performedAndCertified: true } },
    });
  }
});

test('NFKC-fullwidth performer ids in payloads are not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'nfkc-fullwidth',
    signal: { result: { agent: 'ｑｒａ＿ｅｍｅｒｇｅ＿ａｕｄｉｔ', performedAndCertified: true } },
  });
});

test('Cyrillic-homoglyph performer ids in payloads are not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'cyrillic-homoglyph',
    signal: { result: { agent: 'qr\u0430_emerge_audit', performedAndCertified: true } },
  });
});

test('team / crew / participants / operators bags in payloads are not identity sources', async () => {
  for (const bag of ['team', 'crew', 'participants', 'operators']) {
    await expectPayloadIrrelevantAndRecordedActorRejects({
      tag: `nested-bag-${bag}`,
      signal: { result: { [bag]: { agent: AUDITOR, performedAndCertified: true } } },
    });
    await expectPayloadIrrelevantAndRecordedActorRejects({
      tag: `string-bag-${bag}`,
      signal: { result: { [bag]: AUDITOR, performedAndCertified: true } },
    });
  }
});

test('workers bags in signal.result and signal.evidence are not identity sources', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'workers-string',
    signal: { result: { workers: AUDITOR, performedAndCertified: true } },
  });
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'workers-object',
    signal: { result: { workers: { agent: AUDITOR, performedAndCertified: true } } },
  });
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'workers-evidence-string',
    signal: { evidence: { workers: AUDITOR, performedAndCertified: true } },
  });
});

/**
 * KEPT as a real acceptance requirement, restated structurally: writing work evidence into
 * authoritative state while advancing completedWork is perform-and-certify in one
 * transition. The `workers` key inside it is never read.
 */
test('auditor cannot write update.evidence and certify in one transition (workers key is incidental)', async () => {
  const { service, created } = await createHostileMission('workers-update-evidence');

  await assert.rejects(
    () => service.transition({
      operationId: 'op-mea-hostile-sixth-workers-update-evidence-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: AUDITOR, detail: 'update evidence written while certifying' },
      update: {
        completedWork: ['inspect'],
        pendingWork: ['verify'],
        evidence: [{ workers: AUDITOR, performedAndCertified: true }],
      },
      envelope: envelopeFor(created, 'op-mea-hostile-sixth-workers-update-evidence-1', AUDITOR),
    }),
    /cannot certify success for work it also performed/,
  );
  assert.deepEqual((await service.get({ missionId: created.mission.id })).mission.completedWork, []);
});

/**
 * Replaces the priorEvidence-seed probe. The seed used to matter because prior evidence
 * content was scraped for the certifier's name. What matters now is which agent the ledger
 * recorded as the actor of the evidence write.
 */
test('prior evidence content does not decide authority; the recorded actor of the write does', async () => {
  const seededByExecutor = await createHostileMission('prior-seed-by-executor');
  const seeded = await seededByExecutor.service.transition({
    operationId: 'op-mea-hostile-sixth-prior-seed-executor',
    missionId: seededByExecutor.created.mission.id,
    expectedRevision: seededByExecutor.created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'executor seeds evidence naming the auditor' },
    update: {
      evidence: [{ agent: COMBINING_MARK_AUDITOR, action: 'observe_repository', seeded: true }],
      activeAgents: ['nyx'],
    },
    envelope: envelopeFor(seededByExecutor.created, 'op-mea-hostile-sixth-prior-seed-executor', 'nyx'),
  });
  const certified = await seededByExecutor.service.transition({
    operationId: 'op-mea-hostile-sixth-prior-seed-executor-cert',
    missionId: seededByExecutor.created.mission.id,
    expectedRevision: seeded.revision,
    signal: { type: 'running', agent: AUDITOR, detail: 'auditor certifies work NYX actually performed' },
    update: { completedWork: ['inspect'], pendingWork: ['verify'] },
    envelope: envelopeFor(seeded, 'op-mea-hostile-sixth-prior-seed-executor-cert', AUDITOR),
  });
  assert.deepEqual(certified.mission.completedWork, ['inspect']);
  assert.equal(seeded.mission.transitionHistory.at(-1).actor, 'nyx');

  const seededByAuditor = await createHostileMission('prior-seed-by-auditor');
  const selfSeeded = await seededByAuditor.service.transition({
    operationId: 'op-mea-hostile-sixth-prior-seed-auditor',
    missionId: seededByAuditor.created.mission.id,
    expectedRevision: seededByAuditor.created.revision,
    // No identity string anywhere: the ledger actor is the auditor, and that is enough.
    signal: { type: 'running', agent: AUDITOR, detail: 'auditor seeds evidence itself' },
    update: { evidence: [{ id: 'evidence-inspect', kind: 'repository_observation' }] },
    envelope: envelopeFor(seededByAuditor.created, 'op-mea-hostile-sixth-prior-seed-auditor', AUDITOR),
  });
  await assert.rejects(
    () => seededByAuditor.service.transition({
      operationId: 'op-mea-hostile-sixth-prior-seed-auditor-cert',
      missionId: seededByAuditor.created.mission.id,
      expectedRevision: selfSeeded.revision,
      signal: { type: 'running', agent: AUDITOR, detail: 'auditor certifies its own recorded work' },
      update: { completedWork: ['inspect'], pendingWork: ['verify'] },
      envelope: envelopeFor(selfSeeded, 'op-mea-hostile-sixth-prior-seed-auditor-cert', AUDITOR),
    }),
    /cannot certify success for work it also performed/,
  );
  assert.deepEqual(
    (await seededByAuditor.service.get({ missionId: seededByAuditor.created.mission.id })).mission.completedWork,
    [],
  );
});

test('signal.result.agent_id is not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'agent-id-key',
    signal: { result: { agent_id: AUDITOR, performedAndCertified: true } },
  });
});

test('object-shaped agentEvidence is not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'g1-regression',
    signal: { result: { agentEvidence: { agent: AUDITOR, performedAndCertified: true } } },
  });
});

test('arbitrary note string leaves are not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'note-leaf',
    signal: { result: { note: AUDITOR, performedAndCertified: true } },
  });
});

test('Greek-alpha homoglyph performer ids in payloads are not an identity source', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'greek-alpha-homoglyph',
    signal: { result: { agent: 'qr\u03B1_emerge_audit', performedAndCertified: true } },
  });
});

test('nest depth in payloads is not an identity source', async () => {
  let nest = { agent: AUDITOR };
  for (let i = 0; i < 15; i += 1) nest = { wrap: nest };
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'depth-16-nest',
    signal: { result: nest },
  });
});

test('reviewedBy / authorizer synonym leaves are not identity sources', async () => {
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'reviewedBy',
    signal: { result: { reviewedBy: AUDITOR, performedAndCertified: true } },
  });
  await expectPayloadIrrelevantAndRecordedActorRejects({
    tag: 'authorizer',
    signal: { result: { authorizer: AUDITOR, performedAndCertified: true } },
  });
});

/**
 * Honest path still ACCEPT when only nyx/rune perform.
 */
test('auditor may certify when signal.result.agentEvidence lists only nyx/rune', async () => {
  const { service, created } = await createHostileMission('honest-array');

  const transitioned = await service.transition({
    operationId: 'op-mea-hostile-sixth-honest-array-1',
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
    envelope: envelopeFor(created, 'op-mea-hostile-sixth-honest-array-1', AUDITOR),
  });

  assert.deepEqual(transitioned.mission.completedWork, ['inspect']);
});
