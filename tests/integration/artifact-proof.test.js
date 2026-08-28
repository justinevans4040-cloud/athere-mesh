import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeArtifactProof, verifyArtifactProof } from '../../packages/proof/src/proof-store.js';

const artifact = Buffer.from('exact artifact bytes\n');

test('artifact proof binds exact artifact bytes to producer, verifier, mission state, and predecessor hash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'athere-artifact-proof-'));
  const ref = await writeArtifactProof({
    root,
    missionId: 'mission-1',
    artifactId: 'source-main-js',
    artifact,
    predecessorHash: null,
    agent: 'nyx',
    action: 'modified',
    verifierResult: { verifier: 'qr18', verified: true },
    missionStateVersion: 7,
    timestamp: '2026-08-28T14:15:00.000Z',
  });
  assert.match(ref.artifactHash, /^[a-f0-9]{64}$/);
  assert.match(ref.proofHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(await verifyArtifactProof({ root, ref, artifact }), {
    verified: true,
    artifactId: 'source-main-js',
    artifactHash: ref.artifactHash,
    predecessorHash: null,
    agent: 'nyx',
    action: 'modified',
    verifierResult: { verifier: 'qr18', verified: true },
    missionStateVersion: 7,
    timestamp: '2026-08-28T14:15:00.000Z',
  });
});

test('artifact proof rejects different bytes and malformed provenance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'athere-artifact-proof-'));
  const ref = await writeArtifactProof({
    root,
    missionId: 'mission-1',
    artifactId: 'config-json',
    artifact: Buffer.from('{"a":1}\n'),
    predecessorHash: 'a'.repeat(64),
    agent: 'rune',
    action: 'verified',
    verifierResult: { verifier: 'qr18', verified: true },
    missionStateVersion: 8,
    timestamp: '2026-08-28T14:16:00.000Z',
  });
  assert.deepEqual(await verifyArtifactProof({ root, ref, artifact: Buffer.from('{"a":2}\n') }), {
    verified: false,
    artifactId: 'config-json',
    artifactHash: ref.artifactHash,
    reason: 'artifact_hash_mismatch',
  });
  await assert.rejects(() => writeArtifactProof({
    root,
    missionId: 'mission-1',
    artifactId: 'bad',
    artifact: Buffer.from('x'),
    predecessorHash: 'not-a-hash',
    agent: 'nyx',
    action: 'modified',
    verifierResult: { verifier: 'qr18', verified: true },
    missionStateVersion: 1,
    timestamp: '2026-08-28T14:16:00.000Z',
  }), /predecessor hash/i);
});
