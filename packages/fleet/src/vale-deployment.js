import { qraForces, fleetClusters } from './registry.js';

const SHA256 = /^[a-f0-9]{64}$/;

function verifiedArtifact(artifact) {
  return artifact && artifact.verified === true && typeof artifact.path === 'string' && artifact.path.length > 0 && SHA256.test(artifact.sha256);
}

export function planValePrimeDeployment({ artifact, approval } = {}) {
  if (!verifiedArtifact(artifact)) throw new Error('a verified Vale Prime artifact is required');
  const qraTargets = qraForces().map(item => item.id);
  const clusters = fleetClusters();
  const targetCount = qraTargets.length + clusters.length;
  if (!approval) {
    return Object.freeze({
      status: 'needs_approval',
      approvals: Object.freeze([Object.freeze({
        action: 'fleet_deploy',
        artifactSha256: artifact.sha256,
        targetCount,
        reason: 'one consequential approval authorizes the exact Vale Prime fleet deployment batch'
      })])
    });
  }
  if (approval.approved !== true) throw new Error('fleet deployment approval was not granted');
  if (approval.artifactSha256 !== artifact.sha256) throw new Error('approval artifact hash does not match Vale Prime artifact hash');
  const wave = (name, targets) => Object.freeze({ name, targets: Object.freeze(targets) });
  return Object.freeze({
    status: 'staged',
    agentId: 'miss-vale-prime',
    compatibilityAliases: Object.freeze(['miss-vale-core', 'val_core', 'val_exec_tier_preview']),
    artifact: Object.freeze({ path: artifact.path, sha256: artifact.sha256 }),
    approvalId: approval.id,
    waves: Object.freeze([
      wave('qra-forces', qraTargets),
      wave('vanguard-clusters', clusters.filter(item => item.tier === 'vanguard').map(item => item.id)),
      wave('commercial-clusters', clusters.filter(item => item.tier === 'commercial').map(item => item.id))
    ])
  });
}
