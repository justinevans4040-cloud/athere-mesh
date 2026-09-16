import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIFECYCLE_PHASES,
  createLifecycleHooks,
} from '../../packages/agent/src/lifecycle-hooks.js';

test('lifecycle phases are explicit and stable', () => {
  assert.deepEqual([...LIFECYCLE_PHASES], [
    'before_context',
    'after_context',
    'before_agent',
    'after_agent',
    'before_tool',
    'after_tool',
    'before_verification',
    'after_verification',
  ]);
  assert.ok(Object.isFrozen(LIFECYCLE_PHASES));
});

test('hooks receive a deep-frozen clone and run in registration order', async () => {
  const order = [];
  const callerEvent = { missionId: 'mission-1', nested: { value: 1 } };
  const hooks = createLifecycleHooks({ hooks: [
    {
      name: 'first',
      phase: 'before_agent',
      handler: async (event) => {
        order.push('first');
        assert.ok(Object.isFrozen(event));
        assert.ok(Object.isFrozen(event.nested));
        assert.notEqual(event, callerEvent);
        assert.notEqual(event.nested, callerEvent.nested);
        return { note: 'first', tags: ['one'] };
      },
    },
    {
      name: 'second',
      phase: 'before_agent',
      handler: async () => {
        order.push('second');
        return { metrics: { observed: 1 } };
      },
    },
  ] });

  const result = await hooks.run('before_agent', callerEvent);
  assert.deepEqual(order, ['first', 'second']);
  assert.equal(result.length, 2);
  assert.equal(result[0].note, 'first');
  assert.deepEqual(result[1].metrics, { observed: 1 });
  assert.ok(Object.isFrozen(result));
  assert.equal(Object.isFrozen(callerEvent), false);
  assert.equal(Object.isFrozen(callerEvent.nested), false);
});

test('hook metadata rejects authority-bearing fields including nested smuggling', async () => {
  const direct = createLifecycleHooks({ hooks: [
    { phase: 'before_agent', handler: async () => ({ allowed_actions: ['write'] }) },
  ] });
  await assert.rejects(
    () => direct.run('before_agent', { missionId: 'mission-1' }),
    /authority|forbidden|control/i,
  );

  const nested = createLifecycleHooks({ hooks: [
    { phase: 'after_agent', handler: async () => ({ diagnostics: { safe: true, transition: { status: 'completed' } } }) },
  ] });
  await assert.rejects(
    () => nested.run('after_agent', { missionId: 'mission-1' }),
    /authority|forbidden|control/i,
  );
});

test('required hook failures block while optional telemetry hook failures do not', async () => {
  const required = createLifecycleHooks({ hooks: [
    {
      name: 'required-audit',
      phase: 'after_agent',
      required: true,
      handler: async () => { throw new Error('required failed'); },
    },
  ] });
  await assert.rejects(() => required.run('after_agent', {}), /required failed/);

  const optional = createLifecycleHooks({ hooks: [
    {
      name: 'optional-telemetry',
      phase: 'after_agent',
      required: false,
      handler: async () => { throw new Error('telemetry unavailable'); },
    },
  ] });
  assert.deepEqual(await optional.run('after_agent', {}), []);
});

test('unknown phases and invalid hook descriptors are rejected before execution', () => {
  assert.throws(
    () => createLifecycleHooks({ hooks: [{ phase: 'before_authorize', handler: async () => undefined }] }),
    /phase/i,
  );
  assert.throws(
    () => createLifecycleHooks({ hooks: [{ phase: 'before_agent', handler: 'not-a-function' }] }),
    /handler/i,
  );
});
