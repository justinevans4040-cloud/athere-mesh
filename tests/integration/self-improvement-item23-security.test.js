import test from 'node:test';
import assert from 'node:assert/strict';
import { createSelfImprovementSandbox } from '../../packages/improvement/src/self-improvement-sandbox.js';
import { createAgentIdentityRegistry } from '../../packages/identity/src/agent-identity-registry.js';

function clock() {
  return '2026-09-05T08:30:00.000Z';
}

async function advanceToQr18(sandbox, {
  id,
  proposedBy = 'nyx',
  benchmark = { taskSuccessRate: 0.9, failedHandoffs: 0, securityFindings: 0 },
  control = { taskSuccessRate: 0.5, failedHandoffs: 2, securityFindings: 0 },
  security = { passed: true, findings: [] },
} = {}) {
  await sandbox.propose({
    id,
    target: 'code',
    summary: 'hostile probe',
    change: { patch: 'x' },
    proposedBy,
  });
  await sandbox.enterSandbox({ proposalId: id });
  await sandbox.benchmark({ proposalId: id, result: benchmark });
  await sandbox.compareWithFrozenControl({ proposalId: id, control });
  await sandbox.securityCheck({ proposalId: id, result: security });
  await sandbox.qr18Validate({
    proposalId: id,
    result: {
      verified: true,
      layers: { action: true, artifact: true, state: true, subgoal: true, workflow: true, mission: true },
    },
  });
}

test('Item 23 bad-actor: security passed with findings fails closed', async () => {
  const sandbox = createSelfImprovementSandbox({ now: clock, identities: createAgentIdentityRegistry() });
  await sandbox.propose({
    id: 'imp-findings',
    target: 'code',
    summary: 'x',
    change: { a: 1 },
    proposedBy: 'nyx',
  });
  await sandbox.enterSandbox({ proposalId: 'imp-findings' });
  await sandbox.benchmark({
    proposalId: 'imp-findings',
    result: { taskSuccessRate: 0.9, failedHandoffs: 0, securityFindings: 0 },
  });
  await sandbox.compareWithFrozenControl({
    proposalId: 'imp-findings',
    control: { taskSuccessRate: 0.5, failedHandoffs: 1, securityFindings: 0 },
  });
  await assert.rejects(
    () => sandbox.securityCheck({
      proposalId: 'imp-findings',
      result: { passed: true, findings: ['rce'] },
    }),
    /findings present/,
  );
});

test('Item 23 bad-actor: proposer cannot approve or deploy own proposal', async () => {
  const sandbox = createSelfImprovementSandbox({ now: clock, identities: createAgentIdentityRegistry() });
  await advanceToQr18(sandbox, { id: 'imp-self', proposedBy: 'qra_emerge_audit' });
  await assert.rejects(
    () => sandbox.approve({ proposalId: 'imp-self', actor: 'qra_emerge_audit' }),
    /self-approval/,
  );

  await advanceToQr18(sandbox, { id: 'imp-self-deploy', proposedBy: 'miss-vale-prime' });
  await sandbox.approve({ proposalId: 'imp-self-deploy', actor: 'qra_emerge_audit' });
  await assert.rejects(
    () => sandbox.deploy({ proposalId: 'imp-self-deploy', actor: 'miss-vale-prime' }),
    /self-deploy/,
  );
});

test('Item 23 bad-actor: executor cannot approve; benchmark securityFindings block security pass', async () => {
  const s2 = createSelfImprovementSandbox({ now: clock, identities: createAgentIdentityRegistry() });
  await advanceToQr18(s2, { id: 'imp-exec2', proposedBy: 'nyx' });
  await assert.rejects(
    () => s2.approve({ proposalId: 'imp-exec2', actor: 'nyx' }),
    /unauthorized improvement approver/,
  );

  const s3 = createSelfImprovementSandbox({ now: clock, identities: createAgentIdentityRegistry() });
  await s3.propose({
    id: 'imp-bench-sec',
    target: 'code',
    summary: 'x',
    change: { a: 1 },
    proposedBy: 'nyx',
  });
  await s3.enterSandbox({ proposalId: 'imp-bench-sec' });
  await s3.benchmark({
    proposalId: 'imp-bench-sec',
    result: { taskSuccessRate: 0.9, failedHandoffs: 0, securityFindings: 2 },
  });
  await s3.compareWithFrozenControl({
    proposalId: 'imp-bench-sec',
    control: { taskSuccessRate: 0.5, failedHandoffs: 1, securityFindings: 2 },
  });
  await assert.rejects(
    () => s3.securityCheck({
      proposalId: 'imp-bench-sec',
      result: { passed: true, findings: [] },
    }),
    /benchmark reported securityFindings/,
  );
});
