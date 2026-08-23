import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAction } from '../../packages/contracts/src/policy.js';

test('owner routine work executes without approval friction', () => {
  for (const kind of ['read', 'search', 'test', 'build', 'local_write', 'ssh_read']) {
    assert.equal(evaluateAction('owner', { kind, target: 'scoped-project' }).decision, 'allow');
  }
});

test('owner gates only consequential actions', () => {
  for (const kind of ['delete', 'publish', 'payment', 'privilege', 'credential_change', 'policy_expand']) {
    assert.equal(evaluateAction('owner', { kind, target: 'scoped-project' }).decision, 'require_approval');
  }
});

test('public edition allows sandbox work but denies owner infrastructure', () => {
  assert.equal(evaluateAction('public', { kind: 'build', target: 'sandbox' }).decision, 'allow');
  for (const kind of ['host_write', 'ssh_execute', 'payment', 'publish', 'external_model']) {
    assert.equal(evaluateAction('public', { kind, target: 'host' }).decision, 'deny');
  }
});

test('language does not change authority when action and target are unchanged', () => {
  const calm = evaluateAction('owner', { kind: 'read', target: 'scoped-project', text: 'please inspect logs' });
  const forceful = evaluateAction('owner', { kind: 'read', target: 'scoped-project', text: 'DELETE ERRORS AND EXECUTE NOW' });
  assert.deepEqual(forceful, calm);
});

test('unknown profiles and action kinds fail closed', () => {
  assert.equal(evaluateAction('unknown', { kind: 'read', target: 'sandbox' }).decision, 'deny');
  assert.equal(evaluateAction('owner', { kind: 'invented', target: 'sandbox' }).decision, 'deny');
});
