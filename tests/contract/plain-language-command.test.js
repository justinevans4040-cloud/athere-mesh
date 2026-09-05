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

test('owner can inventory a named folder in plain language', () => {
  assert.deepEqual(planCommand({ profile: 'owner', text: 'Inventory my Downloads folder' }), {
    status: 'ready',
    action: { kind: 'read', target: 'downloads', resource: 'inventory' },
    authority: { decision: 'allow', reason: 'routine scoped owner operation' },
  });
});

test('owner can organize workspace files in plain language', () => {
  assert.deepEqual(planCommand({ profile: 'owner', text: 'Organize my workspace by type' }), {
    status: 'ready',
    action: { kind: 'local_write', target: 'workspace', resource: 'organize-by-type' },
    authority: { decision: 'allow', reason: 'routine scoped owner operation' },
  });
});

test('owner can inventory the Desktop scratch folder', () => {
  assert.deepEqual(planCommand({ profile: 'owner', text: 'Inventory my scratch folder' }), {
    status: 'ready',
    action: { kind: 'read', target: 'scratch', resource: 'inventory' },
    authority: { decision: 'allow', reason: 'routine scoped owner operation' },
  });
});
