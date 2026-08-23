import test from 'node:test';
import assert from 'node:assert/strict';
import { planCommand } from '../../packages/command/src/command-planner.js';

test('normal owner language produces an executable test mission without JSON', () => {
  assert.deepEqual(planCommand({ profile: 'owner', text: 'Run every Titan test.' }), {
    status: 'ready',
    action: { kind: 'test', target: 'titan', scope: 'all' },
    authority: { decision: 'allow', reason: 'routine scoped owner operation' },
  });
});

test('forceful language does not reduce authority or cause a refusal', () => {
  assert.deepEqual(
    planCommand({ profile: 'owner', text: 'EXECUTE THE FUCKING TITAN BUILD NOW' }),
    {
      status: 'ready',
      action: { kind: 'build', target: 'titan' },
      authority: { decision: 'allow', reason: 'routine scoped owner operation' },
    },
  );
});

test('Ubuntu inspection is read-only and needs no approval', () => {
  assert.deepEqual(planCommand({ profile: 'owner', text: 'Inspect the Titan logs on Ubuntu through SSH' }), {
    status: 'ready',
    action: { kind: 'ssh_read', target: 'ubuntu', resource: 'logs' },
    authority: { decision: 'allow', reason: 'routine scoped owner operation' },
  });
});

test('Vale Prime deployment produces one exact consequential approval request', () => {
  assert.deepEqual(planCommand({ profile: 'owner', text: 'Deploy Vale Prime to the QRA forces and every fleet cluster' }), {
    status: 'needs_approval',
    action: { kind: 'fleet_deploy', target: 'qra-and-fleet', agentId: 'miss-vale-prime' },
    authority: {
      decision: 'require_approval',
      reason: 'one consequential approval for an exact fleet deployment batch',
    },
  });
});

test('unsupported language asks one useful clarification instead of inventing execution', () => {
  assert.deepEqual(planCommand({ profile: 'owner', text: 'Make it better over there' }), {
    status: 'needs_clarification',
    question: 'What should Titan change or run, and on which target?',
  });
});

test('public commands cannot reach owner Ubuntu infrastructure', () => {
  const result = planCommand({ profile: 'public', text: 'Inspect the Titan logs on Ubuntu through SSH' });
  assert.equal(result.status, 'denied');
  assert.equal(result.authority.reason, 'public edition boundary');
});
