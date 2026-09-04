import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPROVEMENT_STAGES,
  IMPROVEMENT_TARGETS,
  assertImprovementStageOrder,
  assertCannotSelfDeclareProduction,
  normalizeImprovementProposal,
} from '../../packages/contracts/src/self-improvement.js';
import { createSelfImprovementSandbox } from '../../packages/improvement/src/self-improvement-sandbox.js';
import { createAgentIdentityRegistry } from '../../packages/identity/src/agent-identity-registry.js';

test('Item 23 contract: gated stages and forbidden self-declare path', () => {
  assert.deepEqual([...IMPROVEMENT_STAGES], [
    'propose',
    'sandbox',
    'benchmark',
    'compare_with_frozen_control',
    'security_check',
    'qr18_validation',
    'approve',
    'deploy',
    'monitor',
    'rollback_if_required',
  ]);
  for (const target of [
    'prompts', 'workflows', 'routing_policies', 'skills', 'tools',
    'memory_strategy', 'planning_strategy', 'agent_implementations', 'code',
  ]) {
    assert.ok(IMPROVEMENT_TARGETS.includes(target), target);
  }
  assert.equal(assertImprovementStageOrder('propose', 'sandbox'), true);
  assert.throws(() => assertImprovementStageOrder('propose', 'deploy'), /cannot skip/);
  assert.throws(
    () => assertCannotSelfDeclareProduction({ actor: 'nyx', claim: 'better', production: true }),
    /uncontrolled|self-declare|forbidden/,
  );
  const proposal = normalizeImprovementProposal({
    id: 'imp-1',
    target: 'skills',
    summary: 'tighten retry skill',
    change: { procedureAdd: 'escalate after second fail' },
    proposedBy: 'nyx',
  });
  assert.equal(proposal.target, 'skills');
});

test('Item 23 contract: sandbox pipeline blocks uncontrolled production deploy', async () => {
  const sandbox = createSelfImprovementSandbox({ now: () => '2026-09-05T06:00:00.000Z', identities: createAgentIdentityRegistry() });
  const proposal = await sandbox.propose({
    id: 'imp-pipe-1',
    target: 'routing_policies',
    summary: 'prefer local model on inspect',
    change: { route: 'ollama-first' },
    proposedBy: 'nyx',
  });
  assert.equal(proposal.stage, 'propose');

  await assert.rejects(
    () => sandbox.deployToProduction({ proposalId: proposal.id, actor: 'nyx', selfDeclaredBetter: true }),
    /uncontrolled|forbidden|not approved|stage/,
  );

  await sandbox.enterSandbox({ proposalId: proposal.id });
  await sandbox.benchmark({
    proposalId: proposal.id,
    result: { taskSuccessRate: 0.8, failedHandoffs: 1, securityFindings: 0 },
  });
  await sandbox.compareWithFrozenControl({
    proposalId: proposal.id,
    control: { taskSuccessRate: 0.5, failedHandoffs: 3, securityFindings: 0 },
  });
  await sandbox.securityCheck({
    proposalId: proposal.id,
    result: { passed: true, findings: [] },
  });
  await sandbox.qr18Validate({
    proposalId: proposal.id,
    result: {
      verified: true,
      layers: { action: true, artifact: true, state: true, subgoal: true, workflow: true, mission: true },
    },
  });
  await sandbox.approve({ proposalId: proposal.id, actor: 'qra_emerge_audit' });
  const deployed = await sandbox.deploy({ proposalId: proposal.id, actor: 'miss-vale-prime' });
  assert.equal(deployed.stage, 'deploy');
  assert.equal(deployed.production, true);

  const monitored = await sandbox.monitor({
    proposalId: proposal.id,
    actor: 'miss-vale-prime',
    observation: { healthy: false, reason: 'latency regression' },
  });
  assert.equal(monitored.stage, 'monitor');
  const rolled = await sandbox.rollbackIfRequired({ proposalId: proposal.id, actor: 'miss-vale-prime' });
  assert.equal(rolled.stage, 'rollback_if_required');
  assert.equal(rolled.production, false);
  assert.equal(rolled.rolledBack, true);
});
