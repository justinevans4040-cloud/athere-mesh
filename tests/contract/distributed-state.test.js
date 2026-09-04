import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISTRIBUTED_ROLES,
  assertCannotMergeAuthority,
  assertCannotVerifyFromReplica,
  assertForbiddenDistributedPath,
  assertReplicaNotAuthoritative,
  assertWriteAuthority,
  normalizeStateEvent,
  resolveShardId,
} from '../../packages/contracts/src/distributed-state.js';

test('Item 24 contract: primary alone may write; replicas cannot claim authority', () => {
  assert.deepEqual([...DISTRIBUTED_ROLES], ['primary', 'replica', 'event_log']);
  assert.equal(assertWriteAuthority('primary'), 'primary');
  assert.throws(() => assertWriteAuthority('replica'), /write forbidden/);
  assert.throws(() => assertWriteAuthority('event_log'), /write forbidden/);
  assert.throws(
    () => assertReplicaNotAuthoritative({ authoritative: true, role: 'replica' }),
    /authoritative/,
  );
  assert.equal(
    assertReplicaNotAuthoritative({ authoritative: false, role: 'replica', revision: 1 }),
    true,
  );
});

test('Item 24 contract: events normalize; forbidden distribution paths fail closed', () => {
  const event = normalizeStateEvent({
    missionId: 'mission-1',
    revision: 2,
    operationId: 'op-1',
    stateHash: 'abc',
    recordedAt: '2026-09-05T10:00:00.000Z',
  });
  assert.equal(event.type, 'mission_state_saved');
  assert.equal(event.authoritative, true);
  assert.throws(() => normalizeStateEvent({ missionId: 'mission-1', revision: 0, stateHash: 'x', recordedAt: 't' }), /revision/);

  assert.equal(resolveShardId('mission-a', 4).startsWith('shard-'), true);
  assert.throws(() => assertForbiddenDistributedPath('multi_master_write'), /forbidden distributed path/);
  assert.throws(
    () => assertCannotMergeAuthority({
      left: { revision: 1, stateHash: 'a' },
      right: { revision: 2, stateHash: 'b' },
    }),
    /crdt_authority_merge/,
  );
  assert.throws(
    () => assertCannotVerifyFromReplica({ authoritative: false, role: 'replica' }),
    /verification/,
  );
});
