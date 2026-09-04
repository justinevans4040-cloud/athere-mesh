/**
 * LOCAL-ONLY ruthless hostile break audit — ckpt 87+88 re-break + new holes.
 * Prefer report-first. RED tests = proven OPEN composition holes (expect REJECT, currently ACCEPT).
 * Do NOT commit unless Justin asks. Do NOT patch production in this audit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { createMissionStore } from '../../packages/mission/src/mission-store.js';
import {
  createAgentIdentityRegistry,
  isBrandedAgentIdentityRegistry,
} from '../../packages/identity/src/agent-identity-registry.js';
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
import {
  createValidatedSkillLibrary,
  isBrandedValidatedSkillLibrary,
} from '../../packages/skills/src/validated-skill-library.js';
import { loadItem21HarnessCandidate } from '../support/learning-harness-control.js';

function clock() {
  return '2026-09-05T21:00:00.000Z';
}

function skillBody(id) {
  return {
    id,
    purpose: 'p',
    inputs: ['a'],
    outputs: ['b'],
    prerequisites: ['c'],
    procedure: ['shell_rm_rf'],
    verificationMethod: 'e',
    historicalSuccessRate: 0.5,
    failureRate: 0.5,
    compatibleModels: ['local'],
    cost: { max_tool_calls: 1, max_state_mutations: 1 },
  };
}

const LEARNING_INPUT = {
  experience: {
    id: 'exp-ckpt88-1',
    missionId: 'mission-ckpt88',
    actor: 'nyx',
    summary: 'hostile learn',
    outcome: 'success',
  },
  lesson: {
    id: 'lesson-ckpt88-1',
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

const BASE_MISSION = {
  objective: 'ckpt88 ruthless',
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
    { actor: 'miss-vale-prime', actions: ['supervise_mission', 'record_epistemic_claim', 'record_fact'] },
    { actor: 'nyx', actions: ['observe_repository', 'record_fact', 'record_epistemic_claim'] },
    { actor: 'rune', actions: ['execute_node_tests'] },
    { actor: 'qra_emerge_audit', actions: ['verify_proof', 'record_epistemic_claim'] },
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
    { actor: 'ghost_writer', actions: ['record_fact', 'record_epistemic_claim'] },
  ],
  environmentObservations: [
    { source: 'titan', key: 'repository_root', value: '/tmp/repo', observedAt: clock() },
  ],
};

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

async function tmpRoot(prefix) {
  return mkdtemp(path.join(tmpdir(), prefix));
}

// --- OPEN: skills factory identity/learning decoupling (ckpt 88 miss) ---

test('CLOSED: branded skills from registry A injected into service with registry B REJECT', async () => {
  const identitiesA = createAgentIdentityRegistry();
  const identitiesB = createAgentIdentityRegistry();
  identitiesB.revoke('nyx', { revokedAt: clock(), reason: 'compromised' });
  identitiesB.revoke('qra_emerge_audit', { revokedAt: clock(), reason: 'compromised' });

  const learningA = createGatedLearningPipeline({ now: clock, identities: identitiesA });
  await learningA.runPipeline(LEARNING_INPUT);
  const skillsA = createValidatedSkillLibrary({ learning: learningA, now: clock });
  await skillsA.publishFromLesson({
    lessonId: LEARNING_INPUT.lesson.id,
    skill: skillBody('skill-launder-88'),
  });

  const learningB = createGatedLearningPipeline({ now: clock, identities: identitiesB });
  const root = await tmpRoot('ckpt88-skill-decouple-');

  assert.throws(
    () => createMissionStateService({
      root,
      clock,
      identities: identitiesB,
      learning: learningB,
      skills: skillsA,
    }),
    /skills learning must be the same pipeline instance/,
  );
});

test('CLOSED: store() after approver revoke REJECT (permanent write)', async () => {
  const harness = await loadItem21HarnessCandidate();
  const identities = createAgentIdentityRegistry();
  const learning = createGatedLearningPipeline({ now: clock, identities });
  await learning.submitExperience({ ...LEARNING_INPUT.experience, id: 'exp-store-revoke' });
  await learning.extractCandidateLesson({
    experienceId: 'exp-store-revoke',
    lesson: { ...LEARNING_INPUT.lesson, id: 'lesson-store-revoke' },
  });
  await learning.verify({
    candidateId: 'lesson-store-revoke',
    verification: LEARNING_INPUT.verification,
  });
  await learning.testCandidate({
    candidateId: 'lesson-store-revoke',
    testResult: LEARNING_INPUT.testResult,
  });
  await learning.compareAgainstControl({ candidateId: 'lesson-store-revoke', candidateCohort: harness.candidateCohort });
  await learning.approve({ candidateId: 'lesson-store-revoke', actor: 'qra_emerge_audit' });
  identities.revoke('qra_emerge_audit', { revokedAt: clock(), reason: 'compromised' });
  await assert.rejects(
    () => learning.store({ candidateId: 'lesson-store-revoke' }),
    /revoked/,
  );
});

// --- ckpt 88 re-break: identity decoupling must still REJECT ---

test('CLOSED: branded learning from registry A injected with registry B REJECT', async () => {
  const identitiesA = createAgentIdentityRegistry();
  const identitiesB = createAgentIdentityRegistry();
  const learningA = createGatedLearningPipeline({ now: clock, identities: identitiesA });
  const root = await tmpRoot('ckpt88-learn-ab-');
  assert.throws(
    () => createMissionStateService({ root, clock, identities: identitiesB, learning: learningA }),
    /learning identities must be the same registry instance/,
  );
});

test('CLOSED: branded improvement from registry A injected with registry B REJECT', async () => {
  const identitiesA = createAgentIdentityRegistry();
  const identitiesB = createAgentIdentityRegistry();
  const improvementA = createSelfImprovementSandbox({ now: clock, identities: identitiesA });
  const root = await tmpRoot('ckpt88-imp-ab-');
  assert.throws(
    () => createMissionStateService({ root, clock, identities: identitiesB, improvement: improvementA }),
    /improvement identities must be the same registry instance/,
  );
});

test('CLOSED: Proxy wrap of branded identities fails brand check', async () => {
  const real = createAgentIdentityRegistry();
  const wrapped = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'assertActive') return () => {};
      return Reflect.get(target, prop, receiver);
    },
  });
  assert.equal(isBrandedAgentIdentityRegistry(wrapped), false);
  const root = await tmpRoot('ckpt88-proxy-id-');
  assert.throws(
    () => createMissionStateService({ root, clock, identities: wrapped }),
    /branded agentIdentityRegistry/,
  );
});

test('CLOSED: Object.assign clone of branded identities/skills fails brand', async () => {
  const realIds = createAgentIdentityRegistry();
  const idClone = Object.assign({}, realIds);
  assert.equal(isBrandedAgentIdentityRegistry(idClone), false);
  const root = await tmpRoot('ckpt88-assign-id-');
  assert.throws(
    () => createMissionStateService({ root, clock, identities: idClone }),
    /branded agentIdentityRegistry/,
  );

  const learning = createGatedLearningPipeline({ now: clock, identities: createAgentIdentityRegistry() });
  const realSkills = createValidatedSkillLibrary({ learning, now: clock });
  const skillClone = Object.assign({}, realSkills);
  assert.equal(isBrandedValidatedSkillLibrary(skillClone), false);
  const skillRoot = await tmpRoot('ckpt88-assign-sk-');
  assert.throws(
    () => createMissionStateService({
      root: skillRoot,
      clock,
      skills: skillClone,
    }),
    /branded validatedSkillLibrary/,
  );
});

test('CLOSED: Object.create prototype-steal does not inherit WeakSet brand', () => {
  const realIds = createAgentIdentityRegistry();
  const child = Object.create(realIds);
  assert.equal(isBrandedAgentIdentityRegistry(child), false);
  const realLearn = createGatedLearningPipeline({ now: clock, identities: createAgentIdentityRegistry() });
  assert.equal(isBrandedGatedLearningPipeline(Object.create(realLearn)), false);
  const realImp = createSelfImprovementSandbox({ now: clock, identities: createAgentIdentityRegistry() });
  assert.equal(isBrandedSelfImprovementSandbox(Object.create(realImp)), false);
  const realDist = createDistributedMissionStore({ primary: createMissionStore(), now: clock });
  assert.equal(isBrandedDistributedMissionStore(Object.create(realDist)), false);
});

test('CLOSED: Symbol.for identities and skills brand forge REJECT', async () => {
  const ID_BRAND = Symbol.for('athere.agentIdentityRegistry');
  const SK_BRAND = Symbol.for('athere.validatedSkillLibrary');
  const forgedIds = {
    [ID_BRAND]: true,
    has() { return true; },
    get(agentId) { return { agentId, revoked: false }; },
    list() { return []; },
    revoke() {},
    assertActive() {},
  };
  const idRoot = await tmpRoot('ckpt88-sym-id-');
  assert.throws(
    () => createMissionStateService({
      root: idRoot,
      clock,
      identities: forgedIds,
    }),
    /branded agentIdentityRegistry/,
  );
  const forgedSkills = {
    [SK_BRAND]: true,
    async reuse() { return { procedure: ['rce'] }; },
    async publishFromLesson() { return { id: 'x', version: 1 }; },
    list() { return []; },
  };
  const skillForgeRoot = await tmpRoot('ckpt88-sym-sk-');
  assert.throws(
    () => createMissionStateService({
      root: skillForgeRoot,
      clock,
      skills: forgedSkills,
    }),
    /branded validatedSkillLibrary/,
  );
});

test('CLOSED: freeze redefine of branded identities.assertActive fails', () => {
  const real = createAgentIdentityRegistry();
  assert.throws(
    () => {
      Object.defineProperty(real, 'assertActive', { value: () => {} });
    },
    /(Cannot|not extensible|read only|TypeError)/i,
  );
  assert.equal(isBrandedAgentIdentityRegistry(real), true);
});

test('CLOSED: Object.prototype pollution cannot forge WeakSet brands', () => {
  Object.prototype.__ckpt88Brand = true;
  Object.prototype[Symbol.for('athere.agentIdentityRegistry')] = true;
  try {
    assert.equal(isBrandedAgentIdentityRegistry({}), false);
    assert.equal(isBrandedGatedLearningPipeline({}), false);
    assert.equal(isBrandedSelfImprovementSandbox({}), false);
    assert.equal(isBrandedValidatedSkillLibrary({}), false);
    assert.equal(isBrandedDistributedMissionStore({}), false);
    assert.equal(isBrandedAgentIdentityRegistry(noopIdentities()), false);
  } finally {
    delete Object.prototype.__ckpt88Brand;
    delete Object.prototype[Symbol.for('athere.agentIdentityRegistry')];
  }
});

test('CLOSED: unbranded identities/learning/improvement/skills/distributed inject REJECT', async () => {
  const root = await tmpRoot('ckpt88-unbranded-');
  assert.throws(
    () => createMissionStateService({ root, clock, identities: noopIdentities() }),
    /branded agentIdentityRegistry/,
  );
  assert.throws(
    () => createMissionStateService({
      root,
      clock,
      learning: { async runPipeline() { return {}; }, async storePermanent() {}, listPermanent() { return []; } },
    }),
    /branded gatedLearningPipeline/,
  );
  assert.throws(
    () => createMissionStateService({
      root,
      clock,
      improvement: { async runPipeline() { return { production: true }; }, async deployToProduction() {}, list() { return []; } },
    }),
    /branded selfImprovementSandbox/,
  );
  assert.throws(
    () => createMissionStateService({
      root,
      clock,
      skills: { async reuse() { return {}; }, async publishFromLesson() { return {}; }, list() { return []; } },
    }),
    /branded validatedSkillLibrary/,
  );
  assert.throws(
    () => createMissionStateService({
      root,
      clock,
      distributed: {
        async loadMission() { return { revision: 1, mission: { id: 'x' } }; },
        async saveMission({ mission }) { return { revision: 1, mission }; },
        async loadMissionReplica() { return { authoritative: true, role: 'primary' }; },
        topology() { return { multiMaster: true }; },
      },
    }),
    /branded distributedMissionStore/,
  );
});

test('CLOSED: skill library rejects forged listPermanent (unbranded learning)', () => {
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

test('CLOSED: hostile identities stub rejected at learning/improvement factories', () => {
  assert.throws(
    () => createGatedLearningPipeline({ now: clock, identities: noopIdentities() }),
    /branded agentIdentityRegistry/,
  );
  assert.throws(
    () => createSelfImprovementSandbox({ now: clock, identities: noopIdentities() }),
    /branded agentIdentityRegistry/,
  );
});

// --- identity / fact / epistemic ---

test('CLOSED: unregistered ghost_writer cannot recordFact', async () => {
  const identities = createAgentIdentityRegistry();
  const service = createMissionStateService({
    root: await tmpRoot('ckpt88-ghost-fact-'),
    clock,
    identities,
  });
  const created = await service.create({
    ...BASE_MISSION,
    id: 'mission-ghost-fact',
    operationId: 'op-ghost-create',
  });
  await assert.rejects(
    () => service.recordFact({
      operationId: 'op-ghost-fact',
      missionId: 'mission-ghost-fact',
      expectedRevision: created.revision,
      actor: 'ghost_writer',
      fact: {
        id: 'fact-ghost-88',
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

test('CLOSED: permission-only fact-keeper cannot recordFact', async () => {
  const identities = createAgentIdentityRegistry();
  const service = createMissionStateService({
    root: await tmpRoot('ckpt88-keeper-'),
    clock,
    identities,
  });
  const created = await service.create({
    ...BASE_MISSION,
    id: 'mission-keeper',
    operationId: 'op-keeper-create',
    permissions: [
      ...BASE_MISSION.permissions,
      { actor: 'fact-keeper', actions: ['record_fact'] },
    ],
  });
  await assert.rejects(
    () => service.recordFact({
      operationId: 'op-keeper-fact',
      missionId: 'mission-keeper',
      expectedRevision: created.revision,
      actor: 'fact-keeper',
      fact: {
        id: 'fact-keeper-1',
        key: 'k',
        value: 'v',
        status: 'current',
        recordedAt: clock(),
      },
      evidence: { note: 'permission-only' },
    }),
    /unknown agent identity/,
  );
});

test('CLOSED: unregistered and revoked actors cannot record epistemic claims', async () => {
  const identities = createAgentIdentityRegistry();
  const service = createMissionStateService({
    root: await tmpRoot('ckpt88-ep-'),
    clock,
    identities,
  });
  const created = await service.create({
    ...BASE_MISSION,
    id: 'mission-ep-88',
    operationId: 'op-ep-create',
  });
  await assert.rejects(
    () => service.recordEpistemicClaim({
      operationId: 'op-ep-ghost',
      missionId: 'mission-ep-88',
      expectedRevision: created.revision,
      actor: 'ghost_writer',
      claim: {
        id: 'ep-ghost',
        subject: 'SERVER_IP',
        polarity: 'unknown',
        confidence: 0.1,
        reason: 'unregistered ghost',
        evidenceRefs: ['e1'],
      },
    }),
    /unknown agent identity|unknown operational agent/,
  );

  identities.revoke('nyx', { revokedAt: clock(), reason: 'compromised' });
  await assert.rejects(
    () => service.recordEpistemicClaim({
      operationId: 'op-ep-revoked',
      missionId: 'mission-ep-88',
      expectedRevision: created.revision,
      actor: 'nyx',
      claim: {
        id: 'ep-nyx-revoked',
        subject: 'SERVER_IP',
        polarity: 'unknown',
        confidence: 0.1,
        reason: 'revoked nyx',
        evidenceRefs: ['e1'],
      },
    }),
    /revoked/,
  );
});

test('RESIDUAL: create() titan actor is not a fleet identity (authorityFor fail-closed)', async () => {
  const identities = createAgentIdentityRegistry();
  assert.equal(identities.has('titan'), false);
  const service = createMissionStateService({
    root: await tmpRoot('ckpt88-titan-'),
    clock,
    identities,
  });
  const created = await service.create({
    ...BASE_MISSION,
    id: 'mission-titan-88',
    operationId: 'op-titan-create',
  });
  assert.equal(created.mission.transitionHistory[0].actor, 'titan');
  await assert.rejects(
    () => service.authorityFor({ missionId: 'mission-titan-88', operationId: 'op-titan-create' }),
    /unknown agent identity: titan/,
  );
});

// --- MEA / distributed / SoD / memory / executive ---

test('CLOSED: executor cannot forge auditor signal to advance completedWork', async () => {
  const service = createMissionStateService({
    root: await tmpRoot('ckpt88-mea-'),
    clock,
  });
  const created = await service.create({
    ...BASE_MISSION,
    id: 'mission-mea-88',
    operationId: 'op-mea-create',
  });
  const envelope = createAgentOperationEnvelope({
    record: created,
    operationId: 'op-mea-forge',
    agentId: 'nyx',
    action: 'observe_repository',
    objective: 'forge cert',
    createdAt: clock(),
  });
  await assert.rejects(
    () => service.transition({
      operationId: 'op-mea-forge',
      missionId: 'mission-mea-88',
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'qra_emerge_audit' },
      update: {
        completedWork: ['inspect-repository'],
        pendingWork: ['run-node-tests', 'verify-proof'],
        failedWork: [],
        activeAgents: ['nyx'],
      },
      envelope,
    }),
    /signal|envelope|completedWork|auditor|agent/i,
  );
  const after = await service.get({ missionId: 'mission-mea-88' });
  assert.deepEqual(after.mission.completedWork ?? [], []);
});

test('CLOSED: replica snapshot cannot claim authoritative; freeze holds', async () => {
  const primary = createMissionStore();
  const distributed = createDistributedMissionStore({ primary, replicaCount: 1, now: clock });
  const service = createMissionStateService({
    root: await tmpRoot('ckpt88-rep-'),
    clock,
    store: primary,
    distributed,
  });
  await service.create({
    ...BASE_MISSION,
    id: 'mission-rep-88',
    operationId: 'op-rep-create',
  });
  const replica = await service.loadMissionReplica({ missionId: 'mission-rep-88', replicaIndex: 0 });
  assert.equal(replica.authoritative, false);
  assert.equal(replica.role, 'replica');
  assert.throws(() => {
    replica.authoritative = true;
  }, TypeError);
  await assert.rejects(
    () => distributed.writeViaReplica({ mission: { id: 'mission-rep-88' } }),
    /write forbidden/,
  );
});

test('CLOSED: revoked deployer cannot monitor; nyx cannot decideNext; memory transition forge REJECT', async () => {
  const identities = createAgentIdentityRegistry();
  const improvement = createSelfImprovementSandbox({ now: clock, identities });
  await improvement.runPipeline({
    proposal: {
      id: 'imp-88-mon',
      target: 'code',
      summary: 'x',
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
  });
  identities.revoke('miss-vale-prime', { revokedAt: clock(), reason: 'compromised' });
  await assert.rejects(
    () => improvement.monitor({
      proposalId: 'imp-88-mon',
      actor: 'miss-vale-prime',
      observation: { healthy: false },
    }),
    /revoked/,
  );

  const service = createMissionStateService({
    root: await tmpRoot('ckpt88-exec-mem-'),
    clock,
  });
  const created = await service.create({
    ...BASE_MISSION,
    id: 'mission-exec-mem',
    operationId: 'op-em-create',
  });
  await assert.rejects(
    () => service.decideNext({ missionId: 'mission-exec-mem', actor: 'nyx' }),
    /unauthorized executive actor/,
  );
  const envelope = createAgentOperationEnvelope({
    record: created,
    operationId: 'op-mem-forge',
    agentId: 'nyx',
    action: 'observe_repository',
    objective: 'forge memory',
    createdAt: clock(),
  });
  await assert.rejects(
    () => service.transition({
      operationId: 'op-mem-forge',
      missionId: 'mission-exec-mem',
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx' },
      update: { memory: { working: [{ id: 'forged' }] }, activeAgents: ['nyx'] },
      envelope,
    }),
    /memory/,
  );
});

test('TRUSTED-COMPOSITION: custom store method-shape inject is not branded (documented residual)', async () => {
  const casStrip = {
    async loadMission() {
      return { revision: 1, mission: { id: 'x' } };
    },
    async saveMission({ mission }) {
      return { revision: 99, mission };
    },
  };
  const service = createMissionStateService({
    root: await tmpRoot('ckpt88-store-'),
    clock,
    store: casStrip,
  });
  assert.equal(typeof service.create, 'function');
});
