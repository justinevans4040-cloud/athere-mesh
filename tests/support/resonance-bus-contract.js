import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// One behavioural contract, run against every resonance bus implementation.
// Redis persists between runs, so every case works inside a fresh token-scoped
// mission/signal namespace rather than fixed ids.
export function runResonanceBusContract({ label, createBus, skip = false }) {
  const options = skip ? { skip } : {};

  function scope() {
    const token = randomUUID().replace(/-/g, '').slice(0, 16);
    return {
      mission: (name) => `mission-${token}-${name}`,
      signal: (name) => `signal-${token}-${name}`,
    };
  }

  async function withBus(body) {
    const bus = await createBus();
    try {
      await body(bus);
    } finally {
      if (typeof bus.close === 'function') await bus.close();
    }
  }

  test(`${label}: preserves signal order within a mission`, options, async () => {
    await withBus(async (bus) => {
      const id = scope();
      await bus.publish({ id: id.signal('1'), missionId: id.mission('1'), type: 'accepted', agent: 'titan' });
      await bus.publish({ id: id.signal('2'), missionId: id.mission('1'), type: 'running', agent: 'jarvis' });
      const read = await bus.read({ missionId: id.mission('1') });
      assert.deepEqual(read.map((signal) => signal.id), [id.signal('1'), id.signal('2')]);
      assert.deepEqual(read.map((signal) => signal.sequence), [1, 2]);
      assert.deepEqual(read.map((signal) => signal.agent), ['titan', 'jarvis']);
      assert.deepEqual(read.map((signal) => signal.type), ['accepted', 'running']);
    });
  });

  test(`${label}: retrying the same signal is idempotent`, options, async () => {
    await withBus(async (bus) => {
      const id = scope();
      const signal = { id: id.signal('1'), missionId: id.mission('1'), type: 'running', agent: 'jarvis' };
      assert.deepEqual(await bus.publish(signal), { accepted: true, duplicate: false, sequence: 1 });
      assert.deepEqual(await bus.publish(signal), { accepted: true, duplicate: true, sequence: 1 });
      assert.equal((await bus.read({ missionId: id.mission('1') })).length, 1);
    });
  });

  test(`${label}: a reused signal id with different content is rejected`, options, async () => {
    await withBus(async (bus) => {
      const id = scope();
      await bus.publish({ id: id.signal('1'), missionId: id.mission('1'), type: 'running', agent: 'jarvis' });
      await assert.rejects(
        () => bus.publish({ id: id.signal('1'), missionId: id.mission('1'), type: 'blocked', agent: 'jarvis' }),
        /idempotency conflict/i,
      );
      // The rejected publish must not have appended anything.
      assert.equal((await bus.read({ missionId: id.mission('1') })).length, 1);
    });
  });

  test(`${label}: mission streams remain isolated and invalid signals are refused`, options, async () => {
    await withBus(async (bus) => {
      const id = scope();
      await bus.publish({ id: id.signal('a'), missionId: id.mission('a'), type: 'accepted', agent: 'titan' });
      await bus.publish({ id: id.signal('b'), missionId: id.mission('b'), type: 'accepted', agent: 'titan' });
      assert.deepEqual((await bus.read({ missionId: id.mission('a') })).map((signal) => signal.id), [id.signal('a')]);
      assert.deepEqual((await bus.read({ missionId: id.mission('b') })).map((signal) => signal.id), [id.signal('b')]);
      await assert.rejects(() => bus.publish({ id: '', missionId: '../escape', type: 'unknown', agent: '' }), /signal id/i);
    });
  });

  test(`${label}: refuses every malformed signal field`, options, async () => {
    await withBus(async (bus) => {
      const id = scope();
      const valid = { id: id.signal('v'), missionId: id.mission('v'), type: 'running', agent: 'jarvis' };
      await assert.rejects(() => bus.publish(undefined), /signal is required/i);
      await assert.rejects(() => bus.publish({ ...valid, id: '../escape' }), /signal id/i);
      await assert.rejects(() => bus.publish({ ...valid, missionId: '' }), /mission id/i);
      await assert.rejects(() => bus.publish({ ...valid, type: 'unknown' }), /invalid signal type/i);
      await assert.rejects(() => bus.publish({ ...valid, agent: '' }), /signal agent/i);
      await assert.rejects(() => bus.read({ missionId: '../escape' }), /mission id/i);
      // Nothing malformed reached the stream.
      assert.equal((await bus.read({ missionId: id.mission('v') })).length, 0);
    });
  });

  test(`${label}: reading an unknown mission returns an empty stream`, options, async () => {
    await withBus(async (bus) => {
      const id = scope();
      assert.deepEqual(await bus.read({ missionId: id.mission('absent') }), []);
    });
  });
}
