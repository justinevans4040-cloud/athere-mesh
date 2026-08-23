import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryResonanceBus } from '../../packages/resonance/src/resonance-bus.js';

test('resonance bus preserves signal order within a mission', async () => {
  const bus = createMemoryResonanceBus();
  await bus.publish({ id: 'signal-1', missionId: 'mission-1', type: 'accepted', agent: 'titan' });
  await bus.publish({ id: 'signal-2', missionId: 'mission-1', type: 'running', agent: 'jarvis' });
  assert.deepEqual((await bus.read({ missionId: 'mission-1' })).map((signal) => signal.id), ['signal-1', 'signal-2']);
});

test('retrying the same signal is idempotent', async () => {
  const bus = createMemoryResonanceBus();
  const signal = { id: 'signal-1', missionId: 'mission-1', type: 'running', agent: 'jarvis' };
  assert.deepEqual(await bus.publish(signal), { accepted: true, duplicate: false, sequence: 1 });
  assert.deepEqual(await bus.publish(signal), { accepted: true, duplicate: true, sequence: 1 });
  assert.equal((await bus.read({ missionId: 'mission-1' })).length, 1);
});

test('a reused signal id with different content is rejected', async () => {
  const bus = createMemoryResonanceBus();
  await bus.publish({ id: 'signal-1', missionId: 'mission-1', type: 'running', agent: 'jarvis' });
  await assert.rejects(
    () => bus.publish({ id: 'signal-1', missionId: 'mission-1', type: 'blocked', agent: 'jarvis' }),
    /idempotency conflict/i,
  );
});

test('mission streams remain isolated and invalid signals are refused', async () => {
  const bus = createMemoryResonanceBus();
  await bus.publish({ id: 'signal-a', missionId: 'mission-a', type: 'accepted', agent: 'titan' });
  await bus.publish({ id: 'signal-b', missionId: 'mission-b', type: 'accepted', agent: 'titan' });
  assert.deepEqual((await bus.read({ missionId: 'mission-a' })).map((signal) => signal.id), ['signal-a']);
  await assert.rejects(() => bus.publish({ id: '', missionId: '../escape', type: 'unknown', agent: '' }), /signal id/i);
});
