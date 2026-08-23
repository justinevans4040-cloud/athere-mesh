import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeProof, verifyProof } from '../../packages/proof/src/proof-store.js';

test('proof store writes canonical evidence and verifies its SHA-256', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-proof-'));
  const ref = await writeProof({ root, missionId: 'mission-1', payload: { result: 'healthy', node: 'ubuntu' } });
  assert.match(ref.sha256, /^[a-f0-9]{64}$/);
  assert.equal(ref.verified, true);
  assert.deepEqual(await verifyProof({ root, ref }), { verified: true, sha256: ref.sha256 });
});

test('canonical proof hash is independent of object key order', async () => {
  const firstRoot = await mkdtemp(join(tmpdir(), 'titan-proof-a-'));
  const secondRoot = await mkdtemp(join(tmpdir(), 'titan-proof-b-'));
  const first = await writeProof({ root: firstRoot, missionId: 'same', payload: { b: 2, a: 1 } });
  const second = await writeProof({ root: secondRoot, missionId: 'same', payload: { a: 1, b: 2 } });
  assert.equal(first.sha256, second.sha256);
});

test('proof verification detects content tampering', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-proof-'));
  const ref = await writeProof({ root, missionId: 'mission-2', payload: { result: 'original' } });
  await writeFile(join(root, ref.path), '{"result":"tampered"}\n', 'utf8');
  assert.deepEqual(await verifyProof({ root, ref }), { verified: false, sha256: ref.sha256, reason: 'hash_mismatch' });
});

test('proof store rejects traversal and absolute mission identifiers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-proof-'));
  for (const missionId of ['../escape', 'C:\\escape', '/escape']) {
    await assert.rejects(() => writeProof({ root, missionId, payload: { result: true } }), /mission id/i);
  }
});

test('proof is complete JSON with no temporary sibling left behind', async () => {
  const root = await mkdtemp(join(tmpdir(), 'titan-proof-'));
  const ref = await writeProof({ root, missionId: 'mission-3', payload: { nested: { ok: true } } });
  assert.deepEqual(JSON.parse(await readFile(join(root, ref.path), 'utf8')), { nested: { ok: true } });
});
