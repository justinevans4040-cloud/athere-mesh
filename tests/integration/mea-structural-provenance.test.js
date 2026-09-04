import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

const clock = () => '2026-09-05T10:00:00.000Z';
const AUDITOR = 'qra_emerge_audit';

function envelopeFor(record, operationId, agentId) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    objective: 'structural provenance independence',
    createdAt: clock(),
  });
}

async function createMission(tag) {
  const root = await mkdtemp(path.join(tmpdir(), `athere-mea-structural-${tag}-`));
  const service = createMissionStateService({ root, clock });
  const created = await service.create({
    operationId: `op-mea-structural-${tag}-create`,
    id: `mission-mea-structural-${tag}`,
    objective: 'Prove independence is decided from the service-written transition ledger',
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
    currentPlan: { id: `plan-mea-structural-${tag}`, version: 1, steps: ['inspect', 'verify'] },
    environmentObservations: [{ source: 'runtime', key: 'structural', value: true, observedAt: '2026-09-05T09:59:00.000Z' }],
  });
  return { service, created };
}

/**
 * GENUINE CASE: the auditor is the recorded `actor` of a ledger transition that
 * wrote work evidence into authoritative state. Identity comes from the validated
 * envelope, not from any caller-supplied string. It may not then certify that work.
 */
test('auditor that recorded work evidence in a prior ledger transition cannot advance completedWork', async () => {
  const { service, created } = await createMission('prior-recorded-performer');

  const executed = await service.transition({
    operationId: 'op-mea-structural-prior-nyx-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'executor records inspection evidence' },
    update: {
      evidence: [{ id: 'evidence-inspect', kind: 'repository_observation' }],
      activeAgents: ['nyx'],
    },
    envelope: envelopeFor(created, 'op-mea-structural-prior-nyx-1', 'nyx'),
  });

  // The auditor itself performs: it writes work evidence into authoritative state.
  // No caller string names the auditor anywhere; the ledger actor does.
  const performed = await service.transition({
    operationId: 'op-mea-structural-prior-auditor-performs-1',
    missionId: created.mission.id,
    expectedRevision: executed.revision,
    signal: { type: 'running', agent: AUDITOR, detail: 'auditor performs work and records evidence' },
    update: {
      evidence: [
        { id: 'evidence-inspect', kind: 'repository_observation' },
        { id: 'evidence-extra', kind: 'repository_observation' },
      ],
      activeAgents: [],
    },
    envelope: envelopeFor(executed, 'op-mea-structural-prior-auditor-performs-1', AUDITOR),
  });

  const ledgerActors = performed.mission.transitionHistory
    .filter((entry) => Object.hasOwn(entry.changes, 'evidence') && (entry.changes.evidence.after ?? []).length > 0)
    .map(({ actor }) => actor);
  assert.deepEqual(ledgerActors, ['nyx', AUDITOR]);

  await assert.rejects(
    () => service.transition({
      operationId: 'op-mea-structural-prior-auditor-certifies-1',
      missionId: created.mission.id,
      expectedRevision: performed.revision,
      signal: { type: 'running', agent: AUDITOR, detail: 'auditor certifies its own recorded work' },
      update: { completedWork: ['inspect'], pendingWork: ['verify'] },
      envelope: envelopeFor(performed, 'op-mea-structural-prior-auditor-certifies-1', AUDITOR),
    }),
    /cannot certify success for work it also performed/,
  );

  assert.deepEqual((await service.get({ missionId: created.mission.id })).mission.completedWork, []);
});

/**
 * GENUINE CASE: performing and certifying inside one transition. Detected from the
 * authoritative `evidence` write in the validated update, not from its contents.
 */
test('auditor cannot write work evidence and advance completedWork in the same transition', async () => {
  const { service, created } = await createMission('same-transition-performer');

  await assert.rejects(
    () => service.transition({
      operationId: 'op-mea-structural-same-1',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: AUDITOR, detail: 'perform and certify at once' },
      update: {
        completedWork: ['inspect'],
        pendingWork: ['verify'],
        evidence: [{ id: 'evidence-anonymous', kind: 'repository_observation' }],
      },
      envelope: envelopeFor(created, 'op-mea-structural-same-1', AUDITOR),
    }),
    /cannot certify success for work it also performed/,
  );

  assert.deepEqual((await service.get({ missionId: created.mission.id })).mission.completedWork, []);
});

/**
 * GENUINE CASE: mission `completed` is gated by the same recorded-performer rule.
 */
test('auditor that recorded work evidence cannot emit completed', async () => {
  const { service, created } = await createMission('completed-recorded-performer');

  const performed = await service.transition({
    operationId: 'op-mea-structural-completed-perform-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: AUDITOR, detail: 'auditor records work evidence' },
    update: { evidence: [{ id: 'evidence-anonymous', kind: 'repository_observation' }] },
    envelope: envelopeFor(created, 'op-mea-structural-completed-perform-1', AUDITOR),
  });

  await assert.rejects(
    () => service.transition({
      operationId: 'op-mea-structural-completed-certify-1',
      missionId: created.mission.id,
      expectedRevision: performed.revision,
      signal: {
        type: 'completed',
        agent: AUDITOR,
        proof: { verified: true, path: 'proofs/absent.json', sha256: 'a'.repeat(64), operationId: 'absent-proof' },
      },
      update: { completedWork: ['inspect', 'verify'], pendingWork: [], failedWork: [] },
      envelope: envelopeFor(performed, 'op-mea-structural-completed-certify-1', AUDITOR),
    }),
    /cannot certify success for work it also performed/,
  );

  assert.equal((await service.get({ missionId: created.mission.id })).mission.status !== 'completed', true);
});

/**
 * Caller-supplied payload content is intentionally NOT an identity source.
 *
 * Every one of these channels used to be searched by a deep string scrape of the
 * caller's payload. That approach let the attacker control the haystack and could
 * never be proven closed. Independence is now decided from the service-written
 * ledger only, so an executor may write whatever it likes into evidence and the
 * auditor's authority is unaffected. The mission is still MEA-correct: NYX
 * performed the recorded work, the auditor certified it.
 */
test('content-based identity is not a security boundary: planted payload names do not block the auditor', async () => {
  const { service, created } = await createMission('payload-not-a-boundary');

  const planted = await service.transition({
    operationId: 'op-mea-structural-planted-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: {
      type: 'running',
      agent: 'nyx',
      detail: 'executor plants auditor-looking strings across every former scrape channel',
      evidence: { performer: AUDITOR, nested: { wrap: { wrap: AUDITOR } } },
      result: { verifier: AUDITOR, agentEvidence: [{ agent: AUDITOR }] },
    },
    update: {
      evidence: [
        { agent: AUDITOR, executor: 'proof-verifier' },
        { performer: 'qr\u0430_emerge_audit', note: `prefix-${AUDITOR}-suffix` },
        { author: Buffer.from(AUDITOR, 'utf8').toString('base64') },
        { charArray: [...AUDITOR] },
      ],
      activeAgents: ['nyx'],
      artifactReferences: [{ id: 'artifact-1', agent: AUDITOR, verifier: AUDITOR }],
    },
    envelope: envelopeFor(created, 'op-mea-structural-planted-1', 'nyx'),
  });

  const certified = await service.transition({
    operationId: 'op-mea-structural-planted-certify-1',
    missionId: created.mission.id,
    expectedRevision: planted.revision,
    signal: {
      type: 'running',
      agent: AUDITOR,
      detail: 'auditor certifies work NYX actually performed',
      result: { agent: AUDITOR, verifier: AUDITOR, agentEvidence: [{ agent: AUDITOR }] },
    },
    update: { completedWork: ['inspect'], pendingWork: ['verify'], activeAgents: [AUDITOR] },
    envelope: envelopeFor(planted, 'op-mea-structural-planted-certify-1', AUDITOR),
  });

  assert.deepEqual(certified.mission.completedWork, ['inspect']);
  const performers = certified.mission.transitionHistory
    .filter((entry) => Object.hasOwn(entry.changes, 'evidence') && (entry.changes.evidence.after ?? []).length > 0)
    .map(({ actor }) => actor);
  assert.deepEqual(performers, ['nyx']);
});

/**
 * DOCUMENTED BOUNDARY, not an endorsement: the performer signal is an authoritative
 * `evidence` write. Writing `artifactReferences` is the auditor's own certification
 * output (Item 6 provenance) and must stay allowed, and `environmentObservations` and
 * atomic fact operations are separate lifecycles. An auditor can therefore touch those
 * fields and still certify. Pinned here so the limit is explicit rather than accidental.
 */
test('documented boundary: artifactReferences, observations, and fact writes are not performance', async () => {
  const artifacts = await createMission('boundary-artifacts');
  const wroteArtifacts = await artifacts.service.transition({
    operationId: 'op-mea-structural-boundary-artifacts-1',
    missionId: artifacts.created.mission.id,
    expectedRevision: artifacts.created.revision,
    signal: { type: 'running', agent: AUDITOR, detail: 'auditor records artifact provenance' },
    update: { artifactReferences: [{ id: 'mission-proof', agent: AUDITOR }] },
    envelope: envelopeFor(artifacts.created, 'op-mea-structural-boundary-artifacts-1', AUDITOR),
  });
  const certifiedAfterArtifacts = await artifacts.service.transition({
    operationId: 'op-mea-structural-boundary-artifacts-2',
    missionId: artifacts.created.mission.id,
    expectedRevision: wroteArtifacts.revision,
    signal: { type: 'running', agent: AUDITOR, detail: 'certify after artifact provenance write' },
    update: { completedWork: ['inspect'], pendingWork: ['verify'] },
    envelope: envelopeFor(wroteArtifacts, 'op-mea-structural-boundary-artifacts-2', AUDITOR),
  });
  assert.deepEqual(certifiedAfterArtifacts.mission.completedWork, ['inspect']);

  const observations = await createMission('boundary-observations');
  const wroteObservations = await observations.service.transition({
    operationId: 'op-mea-structural-boundary-observations-1',
    missionId: observations.created.mission.id,
    expectedRevision: observations.created.revision,
    signal: { type: 'running', agent: AUDITOR, detail: 'auditor records an observation' },
    update: {
      environmentObservations: [{ source: 'auditor', key: 'probe', value: 1, observedAt: '2026-09-05T09:59:30.000Z' }],
    },
    envelope: envelopeFor(observations.created, 'op-mea-structural-boundary-observations-1', AUDITOR),
  });
  const certifiedAfterObservations = await observations.service.transition({
    operationId: 'op-mea-structural-boundary-observations-2',
    missionId: observations.created.mission.id,
    expectedRevision: wroteObservations.revision,
    signal: { type: 'running', agent: AUDITOR, detail: 'certify after observation write' },
    update: { completedWork: ['inspect'], pendingWork: ['verify'] },
    envelope: envelopeFor(wroteObservations, 'op-mea-structural-boundary-observations-2', AUDITOR),
  });
  assert.deepEqual(certifiedAfterObservations.mission.completedWork, ['inspect']);
});

/**
 * DOCUMENTED BOUNDARY: an auditor may replace the authoritative evidence array with an
 * empty one and then certify, because clearing is not a work-evidence write. The prior
 * value survives in the hash-chained ledger, so provenance is not destroyed.
 */
test('documented boundary: clearing evidence is not performance, and the ledger keeps the prior value', async () => {
  const { service, created } = await createMission('boundary-evidence-clear');

  const performed = await service.transition({
    operationId: 'op-mea-structural-boundary-clear-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx', detail: 'executor records evidence' },
    update: { evidence: [{ id: 'evidence-inspect', kind: 'repository_observation' }] },
    envelope: envelopeFor(created, 'op-mea-structural-boundary-clear-1', 'nyx'),
  });
  const cleared = await service.transition({
    operationId: 'op-mea-structural-boundary-clear-2',
    missionId: created.mission.id,
    expectedRevision: performed.revision,
    signal: { type: 'running', agent: AUDITOR, detail: 'auditor clears evidence' },
    update: { evidence: [] },
    envelope: envelopeFor(performed, 'op-mea-structural-boundary-clear-2', AUDITOR),
  });
  const certified = await service.transition({
    operationId: 'op-mea-structural-boundary-clear-3',
    missionId: created.mission.id,
    expectedRevision: cleared.revision,
    signal: { type: 'running', agent: AUDITOR, detail: 'certify after clearing evidence' },
    update: { completedWork: ['inspect'], pendingWork: ['verify'] },
    envelope: envelopeFor(cleared, 'op-mea-structural-boundary-clear-3', AUDITOR),
  });
  assert.deepEqual(certified.mission.completedWork, ['inspect']);

  const wipe = certified.mission.transitionHistory.find((entry) => entry.actor === AUDITOR && entry.changes?.evidence);
  assert.deepEqual(wipe.changes.evidence.before, [{ id: 'evidence-inspect', kind: 'repository_observation' }]);
  assert.deepEqual(wipe.changes.evidence.after, []);
});

/**
 * Recorded identities come from a closed fleet set, so exact trim+casefold
 * normalization is sufficient. No lookalike folding, no decoding, no deep walk.
 */
test('recorded-actor independence survives a mission whose evidence is deliberately hostile in shape', async () => {
  const { service, created } = await createMission('hostile-shape');

  let nest = AUDITOR;
  for (let i = 0; i < 200; i += 1) nest = { wrap: nest };

  const planted = await service.transition({
    operationId: 'op-mea-structural-hostile-shape-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'rune', detail: 'deep hostile evidence shape' },
    update: { evidence: [{ deep: nest }], activeAgents: ['rune'] },
    envelope: envelopeFor(created, 'op-mea-structural-hostile-shape-1', 'rune'),
  });

  // Payload depth is irrelevant: RUNE performed, the auditor may certify.
  const certified = await service.transition({
    operationId: 'op-mea-structural-hostile-shape-certify-1',
    missionId: created.mission.id,
    expectedRevision: planted.revision,
    signal: { type: 'running', agent: AUDITOR, detail: 'auditor certifies rune work' },
    update: { completedWork: ['inspect'], pendingWork: ['verify'] },
    envelope: envelopeFor(planted, 'op-mea-structural-hostile-shape-certify-1', AUDITOR),
  });
  assert.deepEqual(certified.mission.completedWork, ['inspect']);

  // But once the auditor itself is the recorded actor of an evidence write, it is out.
  const performed = await service.transition({
    operationId: 'op-mea-structural-hostile-shape-perform-1',
    missionId: created.mission.id,
    expectedRevision: certified.revision,
    signal: { type: 'running', agent: AUDITOR, detail: 'auditor performs work' },
    update: { evidence: [{ deep: nest }, { extra: true }] },
    envelope: envelopeFor(certified, 'op-mea-structural-hostile-shape-perform-1', AUDITOR),
  });

  await assert.rejects(
    () => service.transition({
      operationId: 'op-mea-structural-hostile-shape-certify-2',
      missionId: created.mission.id,
      expectedRevision: performed.revision,
      signal: { type: 'running', agent: AUDITOR, detail: 'auditor certifies remaining work it performed' },
      update: { completedWork: ['inspect', 'verify'], pendingWork: [] },
      envelope: envelopeFor(performed, 'op-mea-structural-hostile-shape-certify-2', AUDITOR),
    }),
    /cannot certify success for work it also performed/,
  );
});
