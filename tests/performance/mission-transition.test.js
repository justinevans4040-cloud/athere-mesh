import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createMission, transitionMission } from '../../packages/contracts/src/mission.js';

test('pure mission state engine processes 10000 lifecycles within 250ms', () => {
  const clock = () => '2026-08-23T20:00:00.000Z';
  const started = performance.now();
  for (let index = 0; index < 10_000; index += 1) {
    const accepted = createMission({ id: `mission-${index}`, intent: 'measure deterministic core', clock });
    const running = transitionMission(accepted, { type: 'running', agent: 'bench' }, { clock });
    transitionMission(running, { type: 'completed', agent: 'bench', proof: { path: `proofs/${index}.json`, sha256: 'c'.repeat(64), verified: true } }, { clock });
  }
  const elapsedMs = performance.now() - started;
  assert.ok(elapsedMs < 250, `10000 mission lifecycles took ${elapsedMs.toFixed(2)}ms`);
});
