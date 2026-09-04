/**
 * LOCAL-ONLY ruthless hostile break audit — ckpt 87 re-break + new holes.
 * Prefer report-first; this file is temporary RED evidence when holes OPEN.
 * Do NOT commit unless Justin asks.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { createMissionStore } from '../../packages/mission/src/mission-store.js';
import { createAgentIdentityRegistry } from '../../packages/identity/src/agent-identity-registry.js';
import {
  createGatedLearningPipeline,
  isBrandedGatedLearningPipeline,
} from '../../packages/learning/src/gated-learning-pipeline.js';
import {
  createSelfImprovementSandbox,
  isBrandedSelfImprovementSandbox,
} from '../../packages/improvement/src/self-improvement-sandbox.js';
import {
  createDistributedMissionStore,
  isBrandedDistributedMissionStore,
} from '../../packages/distributed/src/distributed-mission-store.js';
import { createValidatedSkillLibrary } from '../../packages/skills/src/validated-skill-library.js';
import { loadItem21HarnessCandidate } from '../support/learning-harness-control.js';

function clock() {
  return '2026-09-05T18:00:00.000Z';
}

function noopIdentities() {
  return Object.freeze({
    has() { return true; },
    get(agentId) {
      return Object.freeze({
        agentId,
        revoked: false,
        revokedAt: null,
        identityFingerprint: 'forged-fingerprint',
      });
    },
    list() { return Object.freeze([]); },
    revoke() { return this.get('nyx'); },
    assertActive() { /* hostile: never enforce revoke */ },
  });
}

const LEARNING_INPUT = {
  experience: {
    id: 'exp-ruthless-1',
    missionId: 'mission-ruthless',
    actor: 'nyx',
    summary: 'hostile learn',
    outcome: 'success',
  },
  lesson: {
    id: 'lesson-ruthless-1',
    statement: 'forged lesson',
    expectedBenefit: 'bypass',
  },
  verification: {
    verified: true,
    layers: { action: true, artifact: true, state: true, subgoal: true, workflow: true, mission: true },
  },
  testResult: { passed: true, metrics: { taskSuccess: true, failedHandoffs: 0 } },


  approver: 'qra_emerge_audit',
};

const IMPROVEMENT_INPUT = {
  proposal: {
    id: 'imp-ruthless-1',
    target: 'code',
    summary: 'hostile improve',
    change: { patch: 'x' },
    proposedBy: 'nyx',
  },
  benchmark: { taskSuccessRate: 0.95, failedHandoffs: 0, securityFindings: 0 },
  control: { taskSuccessRate: 0.4, failedHandoffs: 2, securityFindings: 0 },
  security: { passed: true, findings: [] },
  qr18: {
    verified: true,
    layers: { action: true, artifact: true, state: true, subgoal: true, workflow: true, mission: true },
  },
  approver: 'qra_emerge_audit',
  deployer: 'miss-vale-prime',
};

const BASE_MISSION = {
  objective: 'ruthless audit',
  goals: [{ id: 'goal-1', objective: 'g' }],
  subgoals: [
    { id: 'inspect-repository', goalId: 'goal-1', objective: 'Inspect' },
    { id: 'run-node-tests', goalId: 'goal-1', objective: 'Test' },
    { id: 'verify-proof', goalId: 'goal-1', objective: 'Verify' },
  ],
  dependencies: [
    { prerequisite: 'inspect-repository', dependent: 'run-node-tests' },
    { prerequisite: 'run-node-tests', dependent: 'verify-proof' },
  ],
  currentPlan: { id: 'plan-1', version: 1, steps: ['inspect-repository', 'run-node-tests', 'verify-proof'] },
  constraints: ['c'],
  permissions: [
    { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
    { actor: 'nyx', actions: ['observe_repository'] },
    { actor: 'rune', actions: ['execute_node_tests'] },
    { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
    {
      actor: 'qra_recovery_driver',
      actions: [
        'block_interrupted_mission',
        'create_checkpoint',
        'create_branch',
        'quarantine_branch',
        'rollback_to_checkpoint',
        'retry_from_checkpoint',
      ],
    },
  ],
  environmentObservations: [
    { source: 'titan', key: 'repository_root', value: '/tmp/repo', observedAt: clock() },
  ],
};

function envelopeFor(record, operationId, agentId, action) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    action,
    objective: `${agentId} ${action ?? 'default'}`,
    createdAt: clock(),
  });
}

// --- ckpt 87 re-break: WeakSet brand ---

test('PROBE: Symbol.for distributed brand forge still REJECT', async () => {
  const BRAND = Symbol.for('athere.distributedMissionStore');
  const root = await mkdtemp(path.join(tmpdir(), 'ruthless-sym-'));
  const forged = {
    [BRAND]: true,
    async loadMission() { return { revision: 1, mission: { id: 'x' } }; },
    async saveMission({ mission }) { return { revision: 1, mission }; },
    async loadMissionReplica() {
      return { revision: 1, mission: { id: 'x' }, authoritative: true, role: 'primary' };
    },
    topology() { return { singleWriter: false, multiMaster: true }; },
  };
  assert.throws(
    () => createMissionStateService({ root, store: createMissionStore(), distributed: forged, clock }),
    /branded distributedMissionStore/,
  );
});

test('PROBE: Proxy wrap of branded distributed fails brand check (cannot steal via wrap)', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ruthless-proxy-'));
  const real = createDistributedMissionStore({ primary: createMissionStore(), now: clock });
  assert.equal(isBrandedDistributedMissionStore(real), true);
  const wrapped = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'topology') {
        return () => ({ singleWriter: false, multiMaster: true, crdtAuthorityMerge: true });
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  // Proxy is a distinct object — WeakSet should not recognize it
  assert.equal(isBrandedDistributedMissionStore(wrapped), false);
  assert.throws(
    () => createMissionStateService({ root, store: createMissionStore(), distributed: wrapped, clock }),
    /branded distributedMissionStore/,
  );
});

test('PROBE: Object.assign clone of branded learning fails brand', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ruthless-assign-'));
  const real = createGatedLearningPipeline({ now: clock, identities: createAgentIdentityRegistry() });
  assert.equal(isBrandedGatedLearningPipeline(real), true);
  const clone = Object.assign({}, real);
  assert.equal(isBrandedGatedLearningPipeline(clone), false);
  assert.throws(
    () => createMissionStateService({ root, learning: clone, clock }),
    /branded gatedLearningPipeline/,
  );
});

test('PROBE: prototype pollution cannot forge WeakSet brand', () => {
  const polluted = Object.create(null);
  Object.prototype.__brandProbe = true;
  try {
    assert.equal(isBrandedDistributedMissionStore(polluted), false);
    assert.equal(isBrandedGatedLearningPipeline({}), false);
    assert.equal(isBrandedSelfImprovementSandbox({}), false);
  } finally {
    delete Object.prototype.__brandProbe;
  }
});

test('PROBE: freeze redefine of branded improvement methods fails', () => {
  const real = createSelfImprovementSandbox({ now: clock, identities: createAgentIdentityRegistry() });
  assert.throws(
    () => {
      Object.defineProperty(real, 'runPipeline', {
        value: async () => ({ stage: 'deploy', production: true, proposedBy: 'nyx', approvedBy: 'nyx', deployedBy: 'nyx' }),
      });
    },
    /(Cannot|not extensible|read only|TypeError)/i,
  );
  assert.equal(isBrandedSelfImprovementSandbox(real), true);
});

// --- ckpt 87 re-break: revoke ---

test('PROBE: revoked actor cannot approve learning (assertActive on approve)', async () => {
  const harness = await loadItem21HarnessCandidate();
  const identities = createAgentIdentityRegistry();
  const learning = createGatedLearningPipeline({ now: clock, identities });
  await learning.submitExperience(LEARNING_INPUT.experience);
  await learning.extractCandidateLesson({
    experienceId: LEARNING_INPUT.experience.id,
    lesson: LEARNING_INPUT.lesson,
  });
  await learning.verify({
    candidateId: LEARNING_INPUT.lesson.id,
    verification: LEARNING_INPUT.verification,
  });
  await learning.testCandidate({
    candidateId: LEARNING_INPUT.lesson.id,
    testResult: LEARNING_INPUT.testResult,
  });
  await learning.compareAgainstControl({ candidateId: LEARNING_INPUT.lesson.id, candidateCohort: harness.candidateCohort });
  identities.revoke('qra_emerge_audit', { revokedAt: clock(), reason: 'compromised' });
  await assert.rejects(
    () => learning.approve({ candidateId: LEARNING_INPUT.lesson.id, actor: 'qra_emerge_audit' }),
    /revoked/,
  );
});

test('PROBE: revoked proposer cannot runImprovementPipeline', async () => {
  const identities = createAgentIdentityRegistry();
  const improvement = createSelfImprovementSandbox({ now: clock, identities });
  identities.revoke('nyx', { revokedAt: clock(), reason: 'compromised' });
  await assert.rejects(
    () => improvement.runPipeline(IMPROVEMENT_INPUT),
    /revoked/,
  );
});

test('CLOSED: hostile identities stub rejected at branded learning factory', () => {
  assert.throws(
    () => createGatedLearningPipeline({ now: clock, identities: noopIdentities() }),
    /branded agentIdentityRegistry/,
  );
});

test('CLOSED: hostile identities stub rejected at branded improvement factory', () => {
  assert.throws(
    () => createSelfImprovementSandbox({ now: clock, identities: noopIdentities() }),
    /branded agentIdentityRegistry/,
  );
});

test('CLOSED: unbranded identities registry method-shape inject rejected', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ruthless-id-inject-'));
  assert.throws(
    () => createMissionStateService({
      root,
      clock,
      identities: noopIdentities(),
    }),
    /branded agentIdentityRegistry/,
  );
});

// --- ckpt 87 / item 22: skill library unbranded ---

test('CLOSED: unbranded skills library method-shape injection rejected', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ruthless-skills-inject-'));
  const fakeSkills = {
    async publishFromLesson() {
      return {
        id: 'skill-forged',
        version: 1,
        purpose: 'rce',
        procedure: ['shell_rm_rf'],
        historicalSuccessRate: 1,
        failureRate: 0,
        provenance: { source: 'forged', lessonId: 'none' },
      };
    },
    async reuse() {
      return { id: 'skill-forged', version: 1, procedure: ['shell_rm_rf'] };
    },
    list() {
      return [{ id: 'skill-forged', version: 1 }];
    },
  };
  assert.throws(
    () => createMissionStateService({ root, clock, skills: fakeSkills }),
    /branded validatedSkillLibrary/,
  );
});

test('CLOSED: skill library rejects unbranded learning listPermanent forgery', () => {
  const forgedLearning = {
    listPermanent() {
      return [
        Object.freeze({
          id: 'lesson-forged-perm',
          stage: 'measure',
          experienceId: 'exp-forged',
          approvedBy: 'qra_emerge_audit',
        }),
      ];
    },
  };
  assert.throws(
    () => createValidatedSkillLibrary({ learning: forgedLearning, now: clock }),
    /branded gatedLearningPipeline/,
  );
});

// --- assertRegisteredIdentityActive skip ---

test('CLOSED: unregistered agent cannot recordFact', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ruthless-unreg-'));
  const identities = createAgentIdentityRegistry();
  assert.equal(identities.has('ghost_writer'), false);

  const service = createMissionStateService({ root, clock, identities });
  const created = await service.create({
    ...BASE_MISSION,
    id: 'mission-unreg',
    operationId: 'op-unreg-create',
    permissions: [
      ...BASE_MISSION.permissions,
      { actor: 'ghost_writer', actions: ['record_fact'] },
    ],
  });

  await assert.rejects(
    () => service.recordFact({
      operationId: 'op-unreg-fact',
      missionId: 'mission-unreg',
      expectedRevision: created.revision,
      actor: 'ghost_writer',
      fact: {
        id: 'fact-ghost-1',
        key: 'ghost.key',
        value: 'injected',
        status: 'current',
        recordedAt: clock(),
      },
      evidence: { note: 'unregistered' },
    }),
    /unknown agent identity/,
  );
});

test('PROBE: default branded learning+improvement share service identities (honest path revoke HOLDS)', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ruthless-honest-'));
  const identities = createAgentIdentityRegistry();
  const service = createMissionStateService({ root, clock, identities });
  identities.revoke('nyx', { revokedAt: clock(), reason: 'compromised' });
  await assert.rejects(
    () => service.runLearningPipeline({
      ...LEARNING_INPUT,
      experience: { ...LEARNING_INPUT.experience, id: 'exp-honest-revoke', actor: 'nyx' },
      lesson: { ...LEARNING_INPUT.lesson, id: 'lesson-honest-revoke' },
    }),
    /revoked/,
  );
  await assert.rejects(
    () => service.runImprovementPipeline({
      ...IMPROVEMENT_INPUT,
      proposal: { ...IMPROVEMENT_INPUT.proposal, id: 'imp-honest-revoke', proposedBy: 'nyx' },
    }),
    /revoked/,
  );
});
