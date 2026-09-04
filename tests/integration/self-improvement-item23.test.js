import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMissionStateService } from '../../packages/mission/src/mission-state-service.js';
import { createSelfImprovementSandbox } from '../../packages/improvement/src/self-improvement-sandbox.js';
import { createAgentIdentityRegistry } from '../../packages/identity/src/agent-identity-registry.js';

function clock() {
  return '2026-09-05T06:30:00.000Z';
}

const RECOVERY_ACTIONS = [
  'block_interrupted_mission',
  'create_checkpoint',
  'create_branch',
  'quarantine_branch',
  'rollback_to_checkpoint',
  'retry_from_checkpoint',
];

function createInput(overrides = {}) {
  return {
    operationId: 'op-imp-create-1',
    id: 'mission-imp-1',
    objective: 'self improvement mission',
    goals: [{ id: 'goal-1', objective: 'Reach the end' }],
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
    constraints: ['completion requires independently verified proof'],
    permissions: [
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'rune', actions: ['execute_node_tests'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
      { actor: 'qra_recovery_driver', actions: [...RECOVERY_ACTIONS] },
    ],
    environmentObservations: [
      { source: 'titan', key: 'repository_root', value: '/tmp/repo', observedAt: clock() },
    ],
    ...overrides,
  };
}

test('Item 23: service runs gated improvement without uncontrolled self-modification', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'athere-imp-'));
  const identities = createAgentIdentityRegistry();
  const improvement = createSelfImprovementSandbox({ now: clock, identities });
  const service = createMissionStateService({ root, clock, identities, improvement });
  const created = await service.create(createInput());

  await assert.rejects(
    () => service.deployImprovementToProduction({
      proposalId: 'missing',
      actor: 'nyx',
      selfDeclaredBetter: true,
    }),
    /uncontrolled|forbidden|unknown|not approved/,
  );

  await assert.rejects(
    () => service.transition({
      operationId: 'op-imp-forge',
      missionId: created.mission.id,
      expectedRevision: created.revision,
      signal: { type: 'running', agent: 'nyx' },
      update: { selfImprovement: [{ id: 'forged', production: true }], activeAgents: ['nyx'] },
    }),
    /envelope|selfImprovement|unsupported/,
  );

  const result = await service.runImprovementPipeline({
    proposal: {
      id: 'imp-svc-1',
      target: 'memory_strategy',
      summary: 'prefer current facts in retrieval ranking',
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
  assert.equal(result.stage, 'deploy');
  assert.equal(result.production, true);
  assert.equal(result.uncontrolledSelfModification, false);
});

test('Item 23: regression vs frozen control cannot approve or deploy', async () => {
  const improvement = createSelfImprovementSandbox({ now: clock, identities: createAgentIdentityRegistry() });
  await improvement.propose({
    id: 'imp-reg-1',
    target: 'code',
    summary: 'risky change',
    change: { patch: 'noop' },
    proposedBy: 'nyx',
  });
  await improvement.enterSandbox({ proposalId: 'imp-reg-1' });
  await improvement.benchmark({
    proposalId: 'imp-reg-1',
    result: { taskSuccessRate: 0.2, failedHandoffs: 9, securityFindings: 1 },
  });
  await assert.rejects(
    () => improvement.compareWithFrozenControl({
      proposalId: 'imp-reg-1',
      control: { taskSuccessRate: 0.9, failedHandoffs: 0, securityFindings: 0 },
    }),
    /regression|not improved|frozen control/,
  );
});
