import test from 'node:test';
import assert from 'node:assert/strict';

import {
  agentsForRole,
  assertIndependentSuccessCertification,
  assertRoleMayAdvanceCompletedWork,
  assertRoleMayEmitSignal,
  assertRoleMayPerformAction,
  authorizeCompletedWorkClaim,
  executionRoles,
  recordedWorkPerformers,
  roleForAgent,
} from '../../packages/contracts/src/execution-roles.js';

test('operational agents map onto manager, executor, auditor, and recovery roles', () => {
  const roles = executionRoles();
  assert.deepEqual(roleForAgent('miss-vale-prime'), roles.manager);
  assert.deepEqual(roleForAgent('nyx'), roles.executor);
  assert.deepEqual(roleForAgent('rune'), roles.executor);
  assert.deepEqual(roleForAgent('qra_emerge_audit'), roles.auditor);
  assert.deepEqual(roleForAgent('qra_recovery_driver'), roles.recovery);
  assert.deepEqual(agentsForRole(roles.executor), ['nyx', 'rune']);
  assert.throws(() => roleForAgent('unknown-agent'), /unknown operational agent/);
});

test('only auditor may emit completed; manager and executor cannot', () => {
  const roles = executionRoles();
  assert.throws(() => assertRoleMayEmitSignal(roles.executor, 'completed'), /only auditor may certify mission success/);
  assert.throws(() => assertRoleMayEmitSignal(roles.manager, 'completed'), /only auditor may certify mission success/);
  assert.doesNotThrow(() => assertRoleMayEmitSignal(roles.auditor, 'completed'));
  assert.doesNotThrow(() => assertRoleMayEmitSignal(roles.auditor, 'running'));
  assert.throws(() => assertRoleMayEmitSignal(roles.recovery, 'running'), /cannot emit running/);
  assert.throws(() => assertRoleMayEmitSignal(roles.manager, 'blocked'), /only recovery may block/);
});

test('only auditor may advance completedWork; executor and manager cannot', () => {
  const roles = executionRoles();
  assert.throws(() => assertRoleMayAdvanceCompletedWork(roles.executor), /only auditor may certify subgoal success/);
  assert.throws(() => assertRoleMayAdvanceCompletedWork(roles.manager), /only auditor may certify subgoal success/);
  assert.doesNotThrow(() => assertRoleMayAdvanceCompletedWork(roles.auditor));
});

test('auditor cannot perform executor actions; executor cannot perform auditor actions', () => {
  const roles = executionRoles();
  assert.throws(
    () => assertRoleMayPerformAction(roles.auditor, 'observe_repository'),
    /cannot perform executor action: observe_repository/,
  );
  assert.throws(
    () => assertRoleMayPerformAction(roles.auditor, 'execute_node_tests'),
    /cannot perform executor action: execute_node_tests/,
  );
  assert.throws(
    () => assertRoleMayPerformAction(roles.executor, 'verify_proof'),
    /cannot perform auditor action: verify_proof/,
  );
  assert.doesNotThrow(() => assertRoleMayPerformAction(roles.executor, 'observe_repository'));
  assert.doesNotThrow(() => assertRoleMayPerformAction(roles.auditor, 'verify_proof'));
});

function ledgerEntry({ actor, action, evidenceAfter }) {
  return {
    actor,
    action,
    changes: evidenceAfter === undefined ? {} : { evidence: { before: [], after: evidenceAfter } },
  };
}

test('recorded performers come from the service-written ledger, never from payload content', () => {
  const history = [
    ledgerEntry({ actor: 'titan', action: 'create', evidenceAfter: [] }),
    ledgerEntry({ actor: 'nyx', action: 'observe_repository' }),
    ledgerEntry({ actor: 'rune', action: 'execute_node_tests', evidenceAfter: [{ any: 'shape' }] }),
    // An auditor transition that changed nothing about evidence is not performance.
    ledgerEntry({ actor: 'qra_emerge_audit', action: 'verify_proof' }),
    // Payload content naming an agent is irrelevant; only the recorded actor counts.
    ledgerEntry({ actor: 'nyx', action: 'observe_repository', evidenceAfter: [{ agent: 'qra_emerge_audit' }] }),
  ];
  assert.deepEqual([...recordedWorkPerformers(history)], ['nyx', 'rune']);
  assert.deepEqual([...recordedWorkPerformers([])], []);
  assert.throws(() => recordedWorkPerformers('not-an-array'), /transitionHistory must be an array/);
});

test('success certification rejects when the certifier is a recorded performer', () => {
  assert.throws(
    () => assertIndependentSuccessCertification({
      certifierAgentId: 'qra_emerge_audit',
      recordedPerformers: ['nyx', 'qra_emerge_audit'],
    }),
    /cannot certify success for work it also performed/,
  );
  // Recorded ids come from the closed fleet set, so trim + casefold is the whole compare.
  assert.throws(
    () => assertIndependentSuccessCertification({
      certifierAgentId: 'qra_emerge_audit',
      recordedPerformers: [' QRA_Emerge_Audit '],
    }),
    /cannot certify success for work it also performed/,
  );
  assert.throws(
    () => assertIndependentSuccessCertification({
      certifierAgentId: 'qra_emerge_audit',
      recordedPerformers: ['nyx'],
      certifierPerformsInThisTransition: true,
    }),
    /cannot certify success for work it also performed/,
  );
  assert.doesNotThrow(() => assertIndependentSuccessCertification({
    certifierAgentId: 'qra_emerge_audit',
    recordedPerformers: ['nyx', 'rune'],
  }));
});

test('authorizeCompletedWorkClaim enforces auditor-only completedWork advancement', () => {
  const nyxPerformed = [ledgerEntry({ actor: 'nyx', action: 'observe_repository', evidenceAfter: [{ id: 'e1' }] })];
  const auditorPerformed = [ledgerEntry({ actor: 'qra_emerge_audit', action: 'verify_proof', evidenceAfter: [{ id: 'e1' }] })];
  assert.throws(
    () => authorizeCompletedWorkClaim({
      agentId: 'nyx',
      transitionHistory: [],
      update: { completedWork: ['inspect'] },
    }),
    /only auditor may certify subgoal success/,
  );
  assert.throws(
    () => authorizeCompletedWorkClaim({
      agentId: 'qra_emerge_audit',
      transitionHistory: auditorPerformed,
      update: { completedWork: ['inspect'] },
    }),
    /cannot certify success for work it also performed/,
  );
  // Writing work evidence in the certifying transition is the same violation.
  assert.throws(
    () => authorizeCompletedWorkClaim({
      agentId: 'qra_emerge_audit',
      transitionHistory: nyxPerformed,
      update: { completedWork: ['inspect'], evidence: [{ id: 'e2' }] },
    }),
    /cannot certify success for work it also performed/,
  );
  assert.deepEqual(
    authorizeCompletedWorkClaim({
      agentId: 'qra_emerge_audit',
      transitionHistory: nyxPerformed,
      update: { completedWork: ['inspect'] },
    }),
    { enforced: true, role: 'auditor', agentId: 'qra_emerge_audit' },
  );
  assert.deepEqual(
    authorizeCompletedWorkClaim({ agentId: 'nyx', update: { activeAgents: ['nyx'] } }),
    { enforced: false },
  );
});