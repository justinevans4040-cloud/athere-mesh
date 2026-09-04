import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EPISTEMIC_POLARITIES,
  assertEpistemicPolaritiesDistinct,
  classifyEpistemicPolarity,
  normalizeEpistemicClaim,
  resolveUncertaintyTriggers,
} from '../../packages/contracts/src/epistemic-state.js';

test('Item 17 contract: three epistemic polarities are distinct', () => {
  assert.deepEqual([...EPISTEMIC_POLARITIES], ['unknown', 'verified_true', 'verified_false']);
  assert.equal(classifyEpistemicPolarity('unknown').kind, 'do_not_know');
  assert.equal(classifyEpistemicPolarity('verified_true').kind, 'verified_true');
  assert.equal(classifyEpistemicPolarity('verified_false').kind, 'verified_false');
  assert.notEqual(
    classifyEpistemicPolarity('unknown').kind,
    classifyEpistemicPolarity('verified_false').kind,
  );
  assertEpistemicPolaritiesDistinct();
});

test('Item 17 contract: unknown triggers evidence/research; verified_false does not collapse to unknown', () => {
  const unknown = normalizeEpistemicClaim({
    id: 'ep-1',
    subject: 'SERVER_IP',
    polarity: 'unknown',
    confidence: 0.2,
    reason: 'no authoritative observation yet',
  });
  const falsified = normalizeEpistemicClaim({
    id: 'ep-2',
    subject: 'SERVER_IP',
    polarity: 'verified_false',
    confidence: 0.9,
    reason: 'probe failed closed',
  });
  const truth = normalizeEpistemicClaim({
    id: 'ep-3',
    subject: 'SERVER_IP',
    polarity: 'verified_true',
    confidence: 0.95,
    reason: 'auditor verified',
  });

  const unknownTriggers = resolveUncertaintyTriggers(unknown);
  const falseTriggers = resolveUncertaintyTriggers(falsified);
  const trueTriggers = resolveUncertaintyTriggers(truth);

  assert.ok(unknownTriggers.includes('collect_evidence'));
  assert.ok(unknownTriggers.includes('research'));
  assert.ok(!unknownTriggers.includes('treat_as_false'));
  assert.ok(falseTriggers.includes('second_verifier') || falseTriggers.includes('alternate_model') || falseTriggers.includes('change_strategy'));
  assert.ok(!falseTriggers.includes('collect_evidence') || falseTriggers.includes('second_verifier'));
  assert.ok(!trueTriggers.includes('escalate_human'));
  assert.ok(!trueTriggers.includes('collect_evidence'));
  assert.notDeepEqual(unknownTriggers, falseTriggers);
  assert.notDeepEqual(falseTriggers, trueTriggers);
});

test('Item 17 contract: invalid polarity and confidence fail closed', () => {
  assert.throws(() => normalizeEpistemicClaim({
    id: 'ep-x',
    subject: 'x',
    polarity: 'maybe',
    confidence: 0.5,
  }), /unsupported epistemic polarity/);
  assert.throws(() => normalizeEpistemicClaim({
    id: 'ep-y',
    subject: 'x',
    polarity: 'unknown',
    confidence: 2,
  }), /confidence/);
  assert.equal(classifyEpistemicPolarity('verified_false').kind, 'verified_false');
});
