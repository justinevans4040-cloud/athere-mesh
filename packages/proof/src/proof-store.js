import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MISSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const PROOF_PATH = /^proofs\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.json$/;
const ARTIFACT_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,191}$/;
const SHA256 = /^[a-f0-9]{64}$/;

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

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requireArtifactId(artifactId) {
  const value = requiredText(artifactId, 'artifact id');
  if (!ARTIFACT_ID.test(value)) throw new Error('invalid artifact id');
  return value;
}

function requireSha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`invalid ${label}`);
  return value;
}

function requireArtifactBytes(artifact) {
  if (typeof artifact === 'string' || Buffer.isBuffer(artifact) || artifact instanceof Uint8Array) return artifact;
  throw new TypeError('artifact must be a string, Buffer, or Uint8Array');
}

function requireTimestamp(value) {
  const timestamp = requiredText(value, 'timestamp');
  if (Number.isNaN(Date.parse(timestamp))) throw new TypeError('timestamp must be an ISO timestamp');
  return timestamp;
}

function requireVerifierResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('verifier result must be an object');
  const verifier = requiredText(value.verifier, 'verifier');
  if (typeof value.verified !== 'boolean') throw new TypeError('verifier result verified must be a boolean');
  return Object.freeze({ ...structuredClone(value), verifier, verified: value.verified });
}

function requireMissionId(missionId) {
  if (!MISSION_ID.test(missionId)) {
    throw new Error('invalid mission id');
  }
}

function artifactProofPath(root, missionId, artifactId, artifactHash) {
  requireMissionId(missionId);
  const safeArtifactId = requireArtifactId(artifactId);
  requireSha256(artifactHash, 'artifact hash');
  const proofRoot = path.resolve(root, 'proofs', 'artifacts', missionId);
  const relativePath = `proofs/artifacts/${missionId}/${safeArtifactId}-${artifactHash}.json`;
  const resolved = path.resolve(root, ...relativePath.split('/'));
  if (path.dirname(resolved) !== proofRoot) throw new Error('artifact proof path escapes root');
  return { relativePath, resolved, proofRoot };
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

export async function writeArtifactProof({
  root,
  missionId,
  artifactId,
  artifact,
  predecessorHash = null,
  agent,
  action,
  verifierResult,
  missionStateVersion,
  timestamp,
}) {
  requireMissionId(missionId);
  const id = requireArtifactId(artifactId);
  const bytes = requireArtifactBytes(artifact);
  if (predecessorHash !== null) requireSha256(predecessorHash, 'predecessor hash');
  const producerAgent = requiredText(agent, 'agent');
  const producerAction = requiredText(action, 'action');
  const verification = requireVerifierResult(verifierResult);
  if (!Number.isSafeInteger(missionStateVersion) || missionStateVersion < 1) {
    throw new TypeError('mission state version must be a positive integer');
  }
  const at = requireTimestamp(timestamp);
  const artifactHash = digest(bytes);
  const { relativePath, resolved, proofRoot } = artifactProofPath(root, missionId, id, artifactHash);
  await mkdir(proofRoot, { recursive: true });

  const record = Object.freeze({
    artifactId: id,
    artifactHash,
    predecessorHash,
    agent: producerAgent,
    action: producerAction,
    verifierResult: verification,
    missionStateVersion,
    timestamp: at,
  });
  const content = `${JSON.stringify(canonicalize(record))}\n`;
  const proofHash = digest(content);
  const temporaryPath = path.join(proofRoot, `.${id}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, resolved);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }

  return Object.freeze({ path: relativePath, proofHash, artifactHash, artifactId: id, verified: true });
}

export async function verifyArtifactProof({ root, ref, artifact }) {
  if (!ref || typeof ref !== 'object') throw new Error('invalid artifact proof reference');
  const artifactId = requireArtifactId(ref.artifactId);
  const artifactHash = requireSha256(ref.artifactHash, 'artifact hash');
  const proofHash = requireSha256(ref.proofHash, 'proof hash');
  const bytes = requireArtifactBytes(artifact);
  const { relativePath, resolved } = artifactProofPath(root, ref.missionId ?? ref.path?.split('/')[2], artifactId, artifactHash);
  if (ref.path !== relativePath) throw new Error('invalid artifact proof path');

  const content = await readFile(resolved);
  if (digest(content) !== proofHash) {
    return { verified: false, artifactId, artifactHash, reason: 'proof_hash_mismatch' };
  }
  if (digest(bytes) !== artifactHash) {
    return { verified: false, artifactId, artifactHash, reason: 'artifact_hash_mismatch' };
  }

  let record;
  try {
    record = JSON.parse(content);
  } catch {
    return { verified: false, artifactId, artifactHash, reason: 'invalid_proof_record' };
  }
  if (record.artifactId !== artifactId || record.artifactHash !== artifactHash) {
    return { verified: false, artifactId, artifactHash, reason: 'proof_binding_mismatch' };
  }
  if (record.predecessorHash !== null) requireSha256(record.predecessorHash, 'predecessor hash');
  const verifier = requireVerifierResult(record.verifierResult);
  if (!Number.isSafeInteger(record.missionStateVersion) || record.missionStateVersion < 1) {
    return { verified: false, artifactId, artifactHash, reason: 'invalid_mission_state_version' };
  }
  const at = requireTimestamp(record.timestamp);
  return Object.freeze({
    verified: true,
    artifactId,
    artifactHash,
    predecessorHash: record.predecessorHash,
    agent: requiredText(record.agent, 'agent'),
    action: requiredText(record.action, 'action'),
    verifierResult: verifier,
    missionStateVersion: record.missionStateVersion,
    timestamp: at,
  });
}
