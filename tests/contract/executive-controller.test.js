import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXECUTIVE_ACTIONS,
  assertExecutivePreservesIntegrity,
  decideNext,
} from '../../packages/executive/src/executive-controller.js';

function baseMission(overrides = {}) {
  return {
    id: 'mission-exec-1',
    status: 'running',
    objective: 'test all of Titan',
    goals: [{ id: 'validate-titan', objective: 'Verify Titan' }],
    subgoals: [
      { id: 'inspect-repository', goalId: 'validate-titan', objective: 'Inspect' },
      { id: 'run-node-tests', goalId: 'validate-titan', objective: 'Test' },
      { id: 'verify-proof', goalId: 'validate-titan', objective: 'Verify' },
    ],
    dependencies: [
      { prerequisite: 'inspect-repository', dependent: 'run-node-tests' },
      { prerequisite: 'run-node-tests', dependent: 'verify-proof' },
    ],
    currentPlan: {
      id: 'titan-test-plan',
      version: 1,
      steps: ['inspect-repository', 'run-node-tests', 'verify-proof'],
    },
    workflowGraph: {
      nodes: [
        { id: 'inspect-repository' },
        { id: 'run-node-tests' },
        { id: 'verify-proof' },
      ],
      edges: [
        { type: 'depends_on', from: 'inspect-repository', to: 'run-node-tests' },
        { type: 'depends_on', from: 'run-node-tests', to: 'verify-proof' },
      ],
    },
    completedWork: [],
    pendingWork: ['inspect-repository', 'run-node-tests', 'verify-proof'],
    failedWork: [],
    evidence: [],
    activeAgents: [],
    checkpoints: [],
    branches: [],
    activeBranchId: 'main',
    permissions: [
      { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
      { actor: 'nyx', actions: ['observe_repository'] },
      { actor: 'rune', actions: ['execute_node_tests'] },
      { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
      { actor: 'qra_recovery_driver', actions: [
        'block_interrupted_mission',
        'create_checkpoint',
        'create_branch',
        'quarantine_branch',
        'rollback_to_checkpoint',
        'retry_from_checkpoint',
      ] },
    ],
    ...overrides,
  };
}

test('Item 16 contract: executive action set is closed', () => {
  for (const action of [
    'allocate_work',
    'verify',
    'retry',
    'change_strategy',
    'stop',
    'escalate_human',
    'research',
  ]) {
    assert.ok(EXECUTIVE_ACTIONS.includes(action), action);
  }
});

test('Item 16 contract: running mission with pending inspect allocates nyx', () => {
  const decision = decideNext({ mission: baseMission() });
  assert.equal(decision.nextAction, 'allocate_work');
  assert.equal(decision.agentId, 'nyx');
  assert.equal(decision.nextWork, 'inspect-repository');
  assert.equal(decision.stop, false);
  assert.equal(decision.integrityPreserved, true);
  assertExecutivePreservesIntegrity(decision, baseMission());
});

test('Item 16 contract: blocked mission with checkpoint changes strategy without breaking integrity', () => {
  const mission = baseMission({
    status: 'blocked',
    completedWork: ['inspect-repository'],
    pendingWork: [],
    failedWork: ['run-node-tests', 'verify-proof'],
    evidence: [{ agent: 'nyx' }],
    activeBranchId: 'br-failing',
    branches: [{ id: 'br-failing', status: 'active', strategy: 'primary', fromCheckpointId: 'cp-1' }],
    checkpoints: [{
      id: 'cp-1',
      verified: true,
      label: 'after-inspect',
      stateHash: 'a'.repeat(64),
      snapshot: { status: 'running', completedWork: ['inspect-repository'] },
    }],
  });
  const decision = decideNext({ mission });
  assert.equal(decision.nextAction, 'change_strategy');
  assert.equal(decision.agentId, 'qra_recovery_driver');
  assert.ok(decision.strategyChange);
  assert.ok(['quarantine_branch', 'retry_from_checkpoint', 'create_branch'].includes(decision.strategyChange.action));
  assert.equal(decision.integrityPreserved, true);
  assert.equal(decision.canCertifySuccess, false);
  assertExecutivePreservesIntegrity(decision, mission);
});

test('Item 16 contract: executive cannot recommend executor self-certify or path skip', () => {
  const mission = baseMission({
    completedWork: [],
    pendingWork: ['inspect-repository', 'run-node-tests', 'verify-proof'],
  });
  assert.throws(
    () => assertExecutivePreservesIntegrity({
      nextAction: 'allocate_work',
      agentId: 'nyx',
      canCertifySuccess: true,
      mutateCompletedWork: ['verify-proof'],
      integrityPreserved: true,
    }, mission),
    /mission integrity/,
  );
  assert.throws(
    () => assertExecutivePreservesIntegrity({
      nextAction: 'allocate_work',
      agentId: 'nyx',
      nextWork: 'verify-proof',
      canCertifySuccess: false,
      integrityPreserved: true,
    }, mission),
    /mission integrity|mission path/,
  );
});
