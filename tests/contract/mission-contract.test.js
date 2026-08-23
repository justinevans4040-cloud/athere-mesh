import test from 'node:test';
import assert from 'node:assert/strict';
import { createMission, transitionMission } from '../../packages/contracts/src/mission.js';

const clock = () => '2026-08-23T20:00:00.000Z';

test('mission follows accepted to running to completed only with verified proof', () => {
  const accepted = createMission({ id: 'mission-1', intent: 'check server health', clock });
  const running = transitionMission(accepted, { type: 'running', agent: 'worker' }, { clock });
  const completed = transitionMission(running, {
    type: 'completed',
    agent: 'worker',
    proof: { path: 'proofs/mission-1.json', sha256: 'a'.repeat(64), verified: true }
  }, { clock });

  assert.equal(completed.status, 'completed');
  assert.equal(completed.coms, 'DONE');
});

test('mission refuses completion without a verified proof', () => {
  const mission = transitionMission(
    createMission({ id: 'mission-2', intent: 'deploy service', clock }),
    { type: 'running', agent: 'worker' },
    { clock }
  );

  assert.throws(
    () => transitionMission(mission, { type: 'completed', agent: 'worker' }, { clock }),
    /verified proof/i
  );
});

test('mission rejects illegal and unknown state transitions', () => {
  const mission = createMission({ id: 'mission-3', intent: 'audit code', clock });
  assert.throws(() => transitionMission(mission, { type: 'completed', agent: 'worker', proof: { path: 'x', sha256: 'b'.repeat(64), verified: true } }, { clock }), /transition/i);
  assert.throws(() => transitionMission(mission, { type: 'chatting', agent: 'worker' }, { clock }), /signal type/i);
});

test('mission rejects empty natural-language intent', () => {
  assert.throws(() => createMission({ id: 'mission-4', intent: '   ', clock }), /intent/i);
});
