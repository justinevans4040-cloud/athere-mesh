import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeProof, verifyProof } from '../../packages/proof/src/proof-store.js';

test('proof store writes canonical evidence and verifies its SHA-256', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-proof-'));
  const ref = await writeProof({ root, missionId: 'mission-1', operationId: 'op-proof-health-1', payload: { result: 'healthy', node: 'ubuntu' } });
  assert.match(ref.sha256, /^[a-f0-9]{64}$/);
  assert.equal(ref.verified, true);
  assert.deepEqual(await verifyProof({ root, ref }), { verified: true, sha256: ref.sha256 });
});

test('canonical proof hash is independent of object key order', async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), 'titan-proof-a-'));
  const secondRoot = await mkdtemp(join(tmpdir(), 'titan-proof-b-'));
  const first = await writeProof({ root: firstRoot, missionId: 'same', operationId: 'op-proof-order-1', payload: { b: 2, a: 1 } });
  const second = await writeProof({ root: secondRoot, missionId: 'same', operationId: 'op-proof-order-1', payload: { a: 1, b: 2 } });
  assert.equal(first.sha256, second.sha256);
});

test('proof verification detects content tampering', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-proof-'));
  const ref = await writeProof({ root, missionId: 'mission-2', operationId: 'op-proof-tamper-1', payload: { result: 'original' } });
  await writeFile(join(root, ref.path), '{"result":"tampered"}\n', 'utf8');
  assert.deepEqual(await verifyProof({ root, ref }), { verified: false, sha256: ref.sha256, reason: 'hash_mismatch' });
});

test('proof store rejects traversal and absolute mission identifiers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-proof-'));
  for (const missionId of ['../escape', 'C:\\escape', '/escape']) {
    await assert.rejects(() => writeProof({ root, missionId, operationId: 'op-proof-invalid-1', payload: { result: true } }), /mission id/i);
  }
});

test('proof is complete JSON with no temporary sibling left behind', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-proof-'));
  const ref = await writeProof({ root, missionId: 'mission-3', operationId: 'op-proof-complete-1', payload: { nested: { ok: true } } });
  assert.deepEqual(JSON.parse(await readFile(join(root, ref.path), 'utf8')), {
    operationId: 'op-proof-complete-1', payload: { nested: { ok: true } },
  });
});

test('proof mutation retries return the immutable result and reject conflicting reuse', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-proof-idempotent-'));
  const request = { root, missionId: 'mission-proof-retry', operationId: 'op-proof-1', payload: { result: 'verified' } };
  const first = await writeProof(request);
  const retry = await writeProof(request);
  assert.equal(retry.sha256, first.sha256);
  assert.equal(retry.duplicate, true);
  await assert.rejects(writeProof({ ...request, payload: { result: 'different' } }), /idempotency conflict/i);
  const newOperation = await writeProof({ ...request, operationId: 'op-proof-2' });
  assert.notEqual(newOperation.path, first.path);
  assert.equal(newOperation.duplicate, undefined);
});
