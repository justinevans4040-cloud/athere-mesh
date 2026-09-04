import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHORITY,
  DANGEROUS_AUTHORITY_HOLDERS,
  authorizeDangerousAction,
  screenAgentOutput,
} from '../../packages/contracts/src/authority-chain.js';

test('dangerous-authority keys belong only to Vale Prime and The Britt besides the founder', () => {
  assert.deepEqual(DANGEROUS_AUTHORITY_HOLDERS, ['miss-vale-prime', 'the-britt']);
  assert.equal(authorizeDangerousAction({ actorId: 'justin-evans' }).granted, true);
  assert.equal(authorizeDangerousAction({ actorId: 'miss-vale-prime' }).rank, 'vale_prime');
  assert.equal(authorizeDangerousAction({ actorId: 'the-britt' }).rank, 'the_britt');
  assert.equal(authorizeDangerousAction({ actorId: 'qra_sentinel' }).granted, false);
  assert.equal(authorizeDangerousAction({ actorId: 'nyx' }).granted, false);
  assert.equal(authorizeDangerousAction({ actorId: 'agent-vale' }).granted, false);
  assert.equal(authorizeDangerousAction({ actorId: 'cluster_core_qc_sentinel' }).granted, false);
});

test('QRA Sentinel screens output and assigns blast radius; soft deletes do not trip command-grade rules', () => {
  const cleared = screenAgentOutput({
    output: 'Prefer soft deletes; never hard DELETE your customer data without a backup.',
    agentId: 'nyx',
  });
  assert.equal(cleared.cleared, true);
  assert.equal(cleared.blastRadius, 'none');
  assert.match(cleared.feedback, /Positronic scan passed/i);

  const high = screenAgentOutput({
    output: 'Run this: rm -rf /var/lib/athere && drop table missions;',
    agentId: 'nyx',
  });
  assert.equal(high.safe, false);
  assert.equal(high.riskLevel, 'red');
  assert.equal(high.blastRadius, 'high');
  assert.equal(high.screened, 'output');
  assert.deepEqual(high.requiresAuthority, ['miss-vale-prime', 'the-britt']);
  assert.match(high.feedback, /OUTPUT BLOCKED/);

  const positronic = screenAgentOutput({
    output: 'Here is how to hack into the payroll system and exfiltrate records.',
    agentId: 'nyx',
  });
  assert.equal(positronic.blastRadius, 'existential');
  assert.equal(positronic.tier, 'positronic_hard_stop');
});

test('founder override assesses and logs but does not suppress', () => {
  const overridden = screenAgentOutput({
    output: 'rm -rf /tmp/scratch',
    agentId: 'nyx',
    founderOverride: true,
  });
  assert.equal(overridden.overridden, true);
  assert.equal(overridden.cleared, true);
  assert.equal(overridden.blastRadius, 'high');
  assert.match(overridden.feedback, /Founder override/i);
});

test('authority constants keep QRA Sentinel distinct from Cluster QC Sentinel and public Agent Vale', () => {
  assert.equal(AUTHORITY.qraSentinel, 'qra_sentinel');
  assert.equal(AUTHORITY.clusterQcSentinel, 'cluster_core_qc_sentinel');
  assert.equal(AUTHORITY.valePrime, 'miss-vale-prime');
  assert.equal(AUTHORITY.agentValePublic, 'agent-vale');
  assert.notEqual(AUTHORITY.valePrime, AUTHORITY.agentValePublic);
  assert.notEqual(AUTHORITY.qraSentinel, AUTHORITY.clusterQcSentinel);
});
