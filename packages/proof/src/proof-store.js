import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MISSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const PROOF_PATH = /^proofs\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.json$/;

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function digest(content) {
  return createHash('sha256').update(content).digest('hex');
}

function requireMissionId(missionId) {
  if (!MISSION_ID.test(missionId)) {
    throw new Error('invalid mission id');
  }
}

function containedProofPath(root, relativePath) {
  if (!PROOF_PATH.test(relativePath)) {
    throw new Error('invalid proof path');
  }
  const proofRoot = path.resolve(root, 'proofs');
  const resolved = path.resolve(root, ...relativePath.split('/'));
  if (path.dirname(resolved) !== proofRoot) {
    throw new Error('proof path escapes root');
  }
  return resolved;
}

export async function writeProof({ root, missionId, payload }) {
  requireMissionId(missionId);
  const relativePath = `proofs/${missionId}.json`;
  const finalPath = containedProofPath(root, relativePath);
  const proofRoot = path.dirname(finalPath);
  await mkdir(proofRoot, { recursive: true });

  const content = `${JSON.stringify(canonicalize(payload))}\n`;
  const temporaryPath = path.join(proofRoot, `.${missionId}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, finalPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }

  return { path: relativePath, sha256: digest(content), verified: true };
}

export async function verifyProof({ root, ref }) {
  if (!ref || typeof ref.sha256 !== 'string') {
    throw new Error('invalid proof reference');
  }
  const proofPath = containedProofPath(root, ref.path);
  const content = await readFile(proofPath);
  const actual = digest(content);
  if (actual !== ref.sha256) {
    return {
      verified: false,
      sha256: ref.sha256,
      reason: 'hash_mismatch',
    };
  }
  return { verified: true, sha256: actual };
}
