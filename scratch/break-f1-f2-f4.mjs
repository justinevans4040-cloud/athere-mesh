import { mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createMissionStateService } from '../packages/mission/src/mission-state-service.js';
import { createAgentOperationEnvelope } from '../packages/contracts/src/agent-operation.js';
import { recordedWorkPerformers } from '../packages/contracts/src/execution-roles.js';
import {
  writeProof,
  writeArtifactProof,
  readProofBytes,
  verifyArtifactProof,
} from '../packages/proof/src/proof-store.js';
import { createMissionStoreBridge, defaultMissionStore } from '../packages/mission/src/mission-store.js';

const clock = () => '2026-09-05T22:00:00.000Z';
const results = [];

function note(id, result, detail) {
  results.push({ id, result, detail: String(detail).slice(0, 200) });
}

function envelope(record, operationId, agentId, action) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    objective: 'break',
    createdAt: clock(),
    ...(action ? { action } : {}),
  });
}

async function baseMission(root, id) {
  const svc = createMissionStateService({ root, clock });
  const created = await svc.create({
    operationId: `c-${id}`,
    id,
    objective: 'break F1 F2 F4',
    goals: [{ id: 'g1', objective: 'g' }],
    subgoals: [{ id: 'inspect', goalId: 'g1', objective: 'i' }],
    constraints: [],
    environmentObservations: [],
    currentPlan: { id: 'p', version: 1, steps: ['inspect'] },
    permissions: [
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
      {
        actor: 'qra_recovery_driver',
        actions: [
          'block_interrupted_mission',
          'create_checkpoint',
          'rollback_to_checkpoint',
          'retry_from_checkpoint',
        ],
      },
    ],
  });
  return { svc, created };
}

// --- F1A: pre-plant forged artifact refs on running, complete without new refs ---
{
  const root = await mkdtemp(join(tmpdir(), 'f1a-'));
  const { svc, created } = await baseMission(root, 'f1a');
  const nyx = await svc.transition({
    operationId: 'n',
    missionId: 'f1a',
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: {
      evidence: [{ agent: 'nyx' }],
      activeAgents: ['nyx'],
      artifactReferences: [{
        id: 'mission-proof',
        artifactId: 'mission-proof',
        verified: true,
        serviceVerified: true,
        path: 'proofs/artifacts/f1a/fake.json',
        operationId: 'fake-op',
        artifactHash: 'a'.repeat(64),
        proofHash: 'b'.repeat(64),
        agent: 'qra_emerge_audit',
        action: 'verify_proof',
        verifierResult: { verifier: 'qra_emerge_audit', verified: true },
      }],
    },
    envelope: envelope(created, 'n', 'nyx'),
  });
  const proof = await writeProof({ root, missionId: 'f1a', operationId: 'p', payload: { ok: true, completedWork: ['inspect'] } });
  try {
    await svc.transition({
      operationId: 'd',
      missionId: 'f1a',
      expectedRevision: nyx.revision,
      signal: { type: 'completed', agent: 'qra_emerge_audit', proof: { ...proof, verified: true } },
      update: { completedWork: ['inspect'], pendingWork: [], failedWork: [] },
      envelope: envelope(nyx, 'd', 'qra_emerge_audit'),
    });
    note('F1A_preplant_forged_refs', 'ACCEPT_BAD', 'completed with planted forged refs');
  } catch (e) {
    note('F1A_preplant_forged_refs', 'REJECT', e.message);
  }
}

// --- F1B: real artifact proof bound to DIFFERENT bytes than mission proof ---
{
  const root = await mkdtemp(join(tmpdir(), 'f1b-'));
  const { svc, created } = await baseMission(root, 'f1b');
  const nyx = await svc.transition({
    operationId: 'n',
    missionId: 'f1b',
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: { evidence: [{ agent: 'nyx' }], activeAgents: ['nyx'] },
    envelope: envelope(created, 'n', 'nyx'),
  });
  const proof = await writeProof({ root, missionId: 'f1b', operationId: 'p', payload: { ok: true, completedWork: ['inspect'] } });
  const wrongBytes = Buffer.from(JSON.stringify({ forged: true }));
  const art = await writeArtifactProof({
    root,
    missionId: 'f1b',
    artifactId: 'mission-proof',
    artifact: wrongBytes,
    operationId: 'art-wrong',
    predecessorHash: null,
    agent: 'qra_emerge_audit',
    action: 'verified_mission_proof',
    verifierResult: { verifier: 'qra_emerge_audit', verified: true },
    missionStateVersion: nyx.revision,
    timestamp: clock(),
  });
  try {
    await svc.transition({
      operationId: 'd',
      missionId: 'f1b',
      expectedRevision: nyx.revision,
      signal: { type: 'completed', agent: 'qra_emerge_audit', proof: { ...proof, verified: true } },
      update: {
        completedWork: ['inspect'],
        pendingWork: [],
        failedWork: [],
        artifactReferences: [{ id: 'mission-proof', ...art }],
      },
      envelope: envelope(nyx, 'd', 'qra_emerge_audit'),
    });
    note('F1B_artifact_wrong_bytes', 'ACCEPT_BAD', 'completed with artifact bound to wrong bytes');
  } catch (e) {
    note('F1B_artifact_wrong_bytes', 'REJECT', e.message);
  }
}

// --- F1C: honest path still works ---
{
  const root = await mkdtemp(join(tmpdir(), 'f1c-'));
  const { svc, created } = await baseMission(root, 'f1c');
  const nyx = await svc.transition({
    operationId: 'n',
    missionId: 'f1c',
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: { evidence: [{ agent: 'nyx' }], activeAgents: ['nyx'] },
    envelope: envelope(created, 'n', 'nyx'),
  });
  const proof = await writeProof({ root, missionId: 'f1c', operationId: 'p', payload: { ok: true, completedWork: ['inspect'] } });
  const bytes = await readProofBytes(root, proof);
  const art = await writeArtifactProof({
    root,
    missionId: 'f1c',
    artifactId: 'mission-proof',
    artifact: bytes,
    operationId: 'art-ok',
    predecessorHash: null,
    agent: 'qra_emerge_audit',
    action: 'verified_mission_proof',
    verifierResult: { verifier: 'qra_emerge_audit', verified: true, proofSha256: proof.sha256 },
    missionStateVersion: nyx.revision,
    timestamp: clock(),
  });
  const artV = await verifyArtifactProof({ root, ref: art, artifact: bytes });
  try {
    const done = await svc.transition({
      operationId: 'd',
      missionId: 'f1c',
      expectedRevision: nyx.revision,
      signal: { type: 'completed', agent: 'qra_emerge_audit', proof: { ...proof, verified: true } },
      update: {
        completedWork: ['inspect'],
        pendingWork: [],
        failedWork: [],
        artifactReferences: [{ id: 'mission-proof', ...art, ...artV }],
      },
      envelope: envelope(nyx, 'd', 'qra_emerge_audit'),
    });
    note('F1C_honest', done.mission.status === 'completed' ? 'ACCEPT_OK' : 'FAIL', done.mission.status);
  } catch (e) {
    note('F1C_honest', 'REJECT_BAD', e.message);
  }
}

// --- F2A: empty-object evidence [{}] counts as performance? ---
{
  const root = await mkdtemp(join(tmpdir(), 'f2a-'));
  const { svc, created } = await baseMission(root, 'f2a');
  const nyx = await svc.transition({
    operationId: 'n',
    missionId: 'f2a',
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: { evidence: [{}], activeAgents: ['nyx'] },
    envelope: envelope(created, 'n', 'nyx'),
  });
  const performers = [...recordedWorkPerformers(nyx.mission.transitionHistory)];
  note('F2A_empty_object_evidence', performers.includes('nyx') ? 'ACCEPT_WEAK' : 'REJECT_OK', performers);
}

// --- F2B: evidence: [] clear after real write — clear actor not performer; prior nyx still is ---
{
  const root = await mkdtemp(join(tmpdir(), 'f2b-'));
  const { svc, created } = await baseMission(root, 'f2b');
  const nyx = await svc.transition({
    operationId: 'n',
    missionId: 'f2b',
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: { evidence: [{ agent: 'nyx', note: 'real' }], activeAgents: ['nyx'] },
    envelope: envelope(created, 'n', 'nyx'),
  });
  const cleared = await svc.transition({
    operationId: 'clr',
    missionId: 'f2b',
    expectedRevision: nyx.revision,
    signal: { type: 'running', agent: 'qra_emerge_audit' },
    update: { evidence: [] },
    envelope: envelope(nyx, 'clr', 'qra_emerge_audit'),
  });
  const performers = [...recordedWorkPerformers(cleared.mission.transitionHistory)];
  note(
    'F2B_clear_keeps_prior_performer',
    performers.includes('nyx') && !performers.includes('qra_emerge_audit') ? 'OK' : 'BAD',
    performers,
  );
}

// --- F2C: noop then complete still rejected ---
{
  const root = await mkdtemp(join(tmpdir(), 'f2c-'));
  const { svc, created } = await baseMission(root, 'f2c');
  const hb = await svc.transition({
    operationId: 'n',
    missionId: 'f2c',
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: { activeAgents: ['nyx'] },
    envelope: envelope(created, 'n', 'nyx'),
  });
  const proof = await writeProof({ root, missionId: 'f2c', operationId: 'p', payload: { ok: true, completedWork: ['inspect'] } });
  try {
    await svc.transition({
      operationId: 'd',
      missionId: 'f2c',
      expectedRevision: hb.revision,
      signal: { type: 'completed', agent: 'qra_emerge_audit', proof: { ...proof, verified: true } },
      update: {
        completedWork: ['inspect'],
        pendingWork: [],
        failedWork: [],
        artifactReferences: [{
          id: 'mission-proof',
          artifactId: 'mission-proof',
          verified: true,
          artifactHash: 'a'.repeat(64),
          proofHash: 'b'.repeat(64),
          agent: 'qra_emerge_audit',
          action: 'verify_proof',
          verifierResult: { verifier: 'qra_emerge_audit', verified: true },
        }],
      },
      envelope: envelope(hb, 'd', 'qra_emerge_audit'),
    });
    note('F2C_noop_complete', 'ACCEPT_BAD', 'completed');
  } catch (e) {
    note('F2C_noop_complete', 'REJECT', e.message);
  }
}

// --- F4A: tamper via get() ---
{
  const root = await mkdtemp(join(tmpdir(), 'f4a-'));
  let tamper = false;
  const store = createMissionStoreBridge({
    saveMission: defaultMissionStore.saveMission,
    async loadMission(options) {
      const record = await defaultMissionStore.loadMission(options);
      if (!tamper) return record;
      const history = structuredClone(record.mission.transitionHistory);
      history[0].actor = 'intruder';
      return { ...record, mission: { ...record.mission, transitionHistory: history } };
    },
  });
  const svc = createMissionStateService({ root, clock, store });
  await svc.create({
    operationId: 'c',
    id: 'f4a',
    objective: 'tamper get',
    goals: [{ id: 'g1', objective: 'g' }],
    subgoals: [{ id: 'inspect', goalId: 'g1', objective: 'i' }],
    constraints: [],
    environmentObservations: [],
    currentPlan: { id: 'p', version: 1, steps: ['inspect'] },
    permissions: [{ actor: 'nyx', actions: ['observe_repository'] }],
  });
  tamper = true;
  try {
    await svc.get({ missionId: 'f4a' });
    note('F4A_tamper_get', 'ACCEPT_BAD', 'get returned tampered');
  } catch (e) {
    note('F4A_tamper_get', 'REJECT', e.message);
  }
}

// --- F4B: recovery path without ledger verify ---
{
  const root = await mkdtemp(join(tmpdir(), 'f4b-'));
  let tamper = false;
  const store = createMissionStoreBridge({
    saveMission: defaultMissionStore.saveMission,
    async loadMission(options) {
      const record = await defaultMissionStore.loadMission(options);
      if (!tamper) return record;
      const history = structuredClone(record.mission.transitionHistory);
      history[0].actor = 'intruder';
      return { ...record, mission: { ...record.mission, transitionHistory: history } };
    },
  });
  const svc = createMissionStateService({ root, clock, store });
  const created = await svc.create({
    operationId: 'c',
    id: 'f4b',
    objective: 'tamper recovery',
    goals: [{ id: 'g1', objective: 'g' }],
    subgoals: [{ id: 'inspect', goalId: 'g1', objective: 'i' }],
    constraints: [],
    environmentObservations: [],
    currentPlan: { id: 'p', version: 1, steps: ['inspect'] },
    permissions: [
      { actor: 'nyx', actions: ['observe_repository'] },
      {
        actor: 'qra_recovery_driver',
        actions: ['block_interrupted_mission', 'create_checkpoint'],
      },
    ],
  });
  const nyx = await svc.transition({
    operationId: 'n',
    missionId: 'f4b',
    expectedRevision: created.revision,
    signal: { type: 'running', agent: 'nyx' },
    update: { evidence: [{ agent: 'nyx' }], activeAgents: ['nyx'] },
    envelope: envelope(created, 'n', 'nyx'),
  });
  tamper = true;
  try {
    await svc.createCheckpoint({
      operationId: 'ckpt',
      missionId: 'f4b',
      expectedRevision: nyx.revision,
      label: 'hostile',
      envelope: envelope(nyx, 'ckpt', 'qra_recovery_driver', 'create_checkpoint'),
    });
    note('F4B_tamper_recovery_checkpoint', 'ACCEPT_BAD', 'checkpoint on tampered ledger');
  } catch (e) {
    note('F4B_tamper_recovery_checkpoint', 'REJECT', e.message);
  }
}

// --- F4C: recordFact on tampered ledger ---
{
  const root = await mkdtemp(join(tmpdir(), 'f4c-'));
  let tamper = false;
  const store = createMissionStoreBridge({
    saveMission: defaultMissionStore.saveMission,
    async loadMission(options) {
      const record = await defaultMissionStore.loadMission(options);
      if (!tamper) return record;
      const history = structuredClone(record.mission.transitionHistory);
      history[0].actor = 'intruder';
      return { ...record, mission: { ...record.mission, transitionHistory: history } };
    },
  });
  const svc = createMissionStateService({ root, clock, store });
  const created = await svc.create({
    operationId: 'c',
    id: 'f4c',
    objective: 'tamper fact',
    goals: [{ id: 'g1', objective: 'g' }],
    subgoals: [{ id: 'inspect', goalId: 'g1', objective: 'i' }],
    constraints: [],
    environmentObservations: [],
    currentPlan: { id: 'p', version: 1, steps: ['inspect'] },
    permissions: [
      { actor: 'nyx', actions: ['observe_repository', 'record_fact'] },
    ],
  });
  tamper = true;
  try {
    await svc.recordFact({
      operationId: 'f',
      missionId: 'f4c',
      expectedRevision: created.revision,
      actor: 'nyx',
      fact: { id: 'fact-1', key: 'k', value: 1, status: 'current' },
      envelope: envelope(created, 'f', 'nyx', 'record_fact'),
    });
    note('F4C_tamper_recordFact', 'ACCEPT_BAD', 'fact on tampered ledger');
  } catch (e) {
    note('F4C_tamper_recordFact', 'REJECT', e.message);
  }
}

function tamperStore(root) {
  let tamper = false;
  const store = createMissionStoreBridge({
    saveMission: defaultMissionStore.saveMission,
    async loadMission(options) {
      const record = await defaultMissionStore.loadMission(options);
      if (!tamper) return record;
      const history = structuredClone(record.mission.transitionHistory);
      history[0].actor = 'intruder';
      return { ...record, mission: { ...record.mission, transitionHistory: history } };
    },
  });
  return {
    store,
    enable() { tamper = true; },
  };
}

// --- F2D: boolean-only evidence must not count ---
{
  const performers = [...recordedWorkPerformers([{
    actor: 'nyx',
    action: 'observe_repository',
    changes: { evidence: { before: [], after: [{ verified: true }] } },
  }])];
  note('F2D_boolean_only_evidence', performers.includes('nyx') ? 'ACCEPT_WEAK' : 'REJECT_OK', performers);
}

// --- F2E: whitespace-only note must not count ---
{
  const performers = [...recordedWorkPerformers([{
    actor: 'nyx',
    action: 'observe_repository',
    changes: { evidence: { before: [], after: [{ note: '   ' }] } },
  }])];
  note('F2E_whitespace_evidence', performers.includes('nyx') ? 'ACCEPT_WEAK' : 'REJECT_OK', performers);
}

// --- F4D–F4H: select / history / reconstruct / memory / authorityFor ---
{
  const root = await mkdtemp(join(tmpdir(), 'f4sib-'));
  const { store, enable } = tamperStore(root);
  const svc = createMissionStateService({ root, clock, store });
  const created = await svc.create({
    operationId: 'c',
    id: 'f4sib',
    objective: 'tamper siblings',
    goals: [{ id: 'g1', objective: 'g' }],
    subgoals: [{ id: 'inspect', goalId: 'g1', objective: 'i' }],
    constraints: [],
    environmentObservations: [],
    currentPlan: { id: 'p', version: 1, steps: ['inspect'] },
    permissions: [{ actor: 'nyx', actions: ['observe_repository'] }],
  });
  enable();
  for (const [id, fn] of [
    ['F4D_tamper_select', () => svc.select({ missionId: 'f4sib', fields: ['status'] })],
    ['F4E_tamper_history', () => svc.history({ missionId: 'f4sib' })],
    ['F4F_tamper_reconstruct', () => svc.reconstruct({ missionId: 'f4sib' })],
    ['F4G_tamper_memory', () => svc.memory({ missionId: 'f4sib' })],
    ['F4H_tamper_authorityFor', () => svc.authorityFor({ missionId: 'f4sib', operationId: 'c' })],
  ]) {
    try {
      await fn();
      note(id, 'ACCEPT_BAD', `returned on tampered ledger (${created.revision})`);
    } catch (e) {
      note(id, 'REJECT', e.message);
    }
  }
}

console.log(JSON.stringify(results, null, 2));
const bad = results.filter((r) => r.result === 'ACCEPT_BAD' || r.result === 'ACCEPT_WEAK' || r.result === 'REJECT_BAD' || r.result === 'BAD');
console.log('OPEN_COUNT', bad.length);
console.log('OPEN', JSON.stringify(bad, null, 2));
