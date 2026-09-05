import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAgentOperationEnvelope } from '../../packages/contracts/src/agent-operation.js';
import { createPostgresProofStore } from '../../packages/postgres/src/postgres-proof-store.js';
import { createSharedProofFacade } from '../../packages/proof/src/shared-proof-facade.js';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';

const clock = () => '2026-09-05T12:00:00.000Z';

function envelopeFor(record, operationId, agentId) {
  return createAgentOperationEnvelope({
    record,
    operationId,
    agentId,
    objective: 'shared proof and skill bind',
    createdAt: clock(),
  });
}

test('shared postgres proofs: second host verifies without local FS bytes', async () => {
  const rows = new Map();
  const client = {
    async query(text, params = []) {
      if (/CREATE TABLE/i.test(text)) return { rows: [] };
      if (/SELECT content/i.test(text)) {
        const hit = rows.get(params[0]);
        return { rows: hit ? [hit] : [] };
      }
      if (/INSERT INTO titan_proofs/i.test(text)) {
        const [proofPath, content, sha256, operationId, kind] = params;
        rows.set(proofPath, {
          content,
          sha256,
          operation_id: operationId,
          kind,
        });
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const shared = await createPostgresProofStore({ db: client });
  const ownerRoot = await mkdtemp(path.join(tmpdir(), 'athere-proof-owner-'));
  const peerRoot = await mkdtemp(path.join(tmpdir(), 'athere-proof-peer-'));
  const facade = createSharedProofFacade({ sharedProofStore: shared });

  const ref = await facade.writeProof({
    root: ownerRoot,
    missionId: 'mission-shared-proof-1',
    operationId: 'op-shared-proof-1',
    payload: { ok: true, tests: { tests: 1, passed: 1, failed: 0, skipped: 0 } },
  });

  const peerFacade = createSharedProofFacade({ sharedProofStore: shared });
  const verified = await peerFacade.verifyProof({ root: peerRoot, ref });
  assert.equal(verified.verified, true);
  assert.equal(verified.source, 'shared-postgres');
  assert.ok(await peerFacade.readProofBytes(peerRoot, ref));
});

test('validatedSkillBindings enter mission stateHash and cannot be forged via transition', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-skill-bind-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create({
    operationId: 'op-skill-bind-create',
    id: 'mission-skill-bind-1',
    objective: 'bind skills into mission authority',
    goals: [{ id: 'goal-1', objective: 'g' }],
    subgoals: [{ id: 'inspect', objective: 'Inspect', goalId: 'goal-1' }],
    dependencies: [],
    constraints: [],
    permissions: [
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
      { actor: 'qra_recovery_driver', actions: ['block_interrupted_mission'] },
    ],
    currentPlan: { id: 'plan-1', version: 1, steps: ['inspect'] },
    environmentObservations: [{ source: 't', key: 'k', value: true, observedAt: '2026-09-05T00:00:00.000Z' }],
  });

  await service.runLearningPipeline({
    experience: {
      id: 'exp-skill-bind-1',
      missionId: created.mission.id,
      actor: 'nyx',
      summary: 'retry inspect recovered',
      outcome: 'success',
    },
    lesson: {
      id: 'lesson-skill-bind-1',
      statement: 'retry inspect once',
      expectedBenefit: 'fewer failed handoffs',
    },
    verification: {
      verified: true,
      layers: { action: true, artifact: true, state: true, subgoal: true, workflow: true, mission: true },
    },
    testResult: { passed: true, metrics: { taskSuccess: true, failedHandoffs: 0 } },
    approver: 'qra_emerge_audit',
  });

  const skill = await service.publishSkillFromLesson({
    lessonId: 'lesson-skill-bind-1',
    skill: {
      id: 'skill-inspect-bind',
      purpose: 'inspect',
      inputs: ['repo'],
      outputs: ['report'],
      prerequisites: ['none'],
      procedure: ['inspect'],
      verificationMethod: 'tests',
      historicalSuccessRate: 0.9,
      failureRate: 0.1,
      compatibleModels: ['local'],
      cost: { max_tool_calls: 1, max_state_mutations: 0 },
    },
  });

  await assert.rejects(
    () => service.transition({
      operationId: 'op-forge-skill-bind',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx', detail: 'forge' },
      update: { validatedSkillBindings: [{ skillId: 'forged' }], activeAgents: ['nyx'] },
      envelope: envelopeFor(created, 'op-forge-skill-bind', 'nyx'),
    }),
    /validatedSkillBindings/,
  );

  const before = await service.verifyHistory({ missionId: created.mission.id });
  const bound = await service.bindValidatedSkill({
    operationId: 'op-bind-skill-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    actor: 'nyx',
    skillId: skill.id,
    version: skill.version,
  });
  assert.equal(bound.mission.validatedSkillBindings.length, 1);
  assert.equal(bound.mission.validatedSkillBindings[0].skillId, skill.id);
  assert.match(bound.mission.validatedSkillBindings[0].contentHash, /^[a-f0-9]{64}$/);
  const after = await service.verifyHistory({ missionId: created.mission.id });
  assert.notEqual(after.stateHash, before.stateHash);
});

test('improvementBindings enter mission stateHash and cannot be forged via transition', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-imp-bind-'));
  const service = createMissionStateService({ root, clock });
  const created = await service.create({
    operationId: 'op-imp-bind-create',
    id: 'mission-imp-bind-1',
    objective: 'bind improvements into mission authority',
    goals: [{ id: 'goal-1', objective: 'g' }],
    subgoals: [{ id: 'inspect', objective: 'Inspect', goalId: 'goal-1' }],
    dependencies: [],
    constraints: [],
    permissions: [
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
      { actor: 'qra_recovery_driver', actions: ['block_interrupted_mission'] },
    ],
    currentPlan: { id: 'plan-1', version: 1, steps: ['inspect'] },
    environmentObservations: [{ source: 't', key: 'k', value: true, observedAt: '2026-09-05T00:00:00.000Z' }],
  });

  await assert.rejects(
    () => service.transition({
      operationId: 'op-forge-imp-bind',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx', detail: 'forge' },
      update: { improvementBindings: [{ proposalId: 'forged' }], activeAgents: ['nyx'] },
      envelope: envelopeFor(created, 'op-forge-imp-bind', 'nyx'),
    }),
    /improvementBindings|selfImprovement/,
  );

  const deployed = await service.runImprovementPipeline({
    proposal: {
      id: 'imp-bind-1',
      target: 'memory_strategy',
      summary: 'prefer current facts',
      change: { rank: 'current_over_similar' },
      proposedBy: 'nyx',
    },
    benchmark: { taskSuccessRate: 0.85, failedHandoffs: 0, securityFindings: 0 },
    control: { taskSuccessRate: 0.6, failedHandoffs: 2, securityFindings: 0 },
    security: { passed: true, findings: [] },
    qr18: {
      verified: true,
      layers: { action: true, artifact: true, state: true, subgoal: true, workflow: true, mission: true },
    },
    approver: 'qra_emerge_audit',
    deployer: 'miss-vale-prime',
  });
  assert.equal(deployed.stage, 'deploy');

  const before = await service.verifyHistory({ missionId: created.mission.id });
  const bound = await service.bindDeployedImprovement({
    operationId: 'op-bind-imp-1',
    missionId: created.mission.id,
    expectedRevision: created.revision,
    actor: 'nyx',
    proposalId: deployed.id,
  });
  assert.equal(bound.mission.improvementBindings.length, 1);
  assert.equal(bound.mission.improvementBindings[0].proposalId, deployed.id);
  assert.match(bound.mission.improvementBindings[0].contentHash, /^[a-f0-9]{64}$/);
  const after = await service.verifyHistory({ missionId: created.mission.id });
  assert.notEqual(after.stateHash, before.stateHash);
});
