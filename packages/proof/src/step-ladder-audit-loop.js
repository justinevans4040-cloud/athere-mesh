/**
 * Runtime step-ladder audit loop over QR18 Levels 1–6.
 *
 * This is the product encoding of the Mesh ladder / rung / MEA auditor path:
 * walk rungs in order against authoritative mission state (not chat), never skip,
 * never let the model self-certify. Certification remains auditor + QR18.
 */

import {
  QR18_LEVELS,
  evaluateQr18Layers,
} from './qr18-layered-verification.js';

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function evaluateAuditLadder({
  mission,
  proofVerification,
  certifierAgentId,
  transitionHistory,
} = {}) {
  const qr18 = evaluateQr18Layers({
    mission,
    proofVerification,
    certifierAgentId,
    transitionHistory,
  });
  const nextRung = qr18.levels.find((level) => level.verified !== true) ?? null;
  const walked = [];
  for (const level of qr18.levels) {
    walked.push(level);
    if (level.verified !== true) break;
  }
  const skipped = [];
  const loop = qr18.verified === true
    ? 'certify'
    : 'continue';
  return Object.freeze({
    verifier: 'qr18-step-ladder',
    levelsExpected: QR18_LEVELS.length,
    qr18,
    nextRung: nextRung === null ? null : Object.freeze({ ...nextRung }),
    skippedRungs: Object.freeze(skipped),
    certified: loop === 'certify',
    loop,
    blockReason: null,
    walkedPrefix: Object.freeze(walked.map((level) => level.id)),
  });
}

export function assertAuditLadderIntact(result) {
  if (!plainObject(result) || result.verifier !== 'qr18-step-ladder') {
    throw new Error('audit ladder result missing');
  }
  if (Array.isArray(result.skippedRungs) && result.skippedRungs.length > 0) {
    throw new Error(result.blockReason ?? `audit ladder skipped rungs: ${result.skippedRungs.join(',')}`);
  }
  return result;
}

/**
 * Walk rungs in order until the first unverified rung or all six verify.
 * Does not emit `completed` — auditor-only certification remains in the
 * mission-state-service completion gate. A later QR18 level may currently
 * evaluate true while an earlier rung is still open; that is not a skip.
 * Skip is claiming certify / completion while any earlier rung failed.
 */
export function runAuditLadderLoop(input = {}) {
  const result = evaluateAuditLadder(input);
  assertAuditLadderIntact(result);
  if (input.claimCertified === true && result.loop !== 'certify') {
    throw new Error(`audit ladder blocked: completion claimed before rungs ${result.qr18.failedLevels.join(',')}`);
  }
  const walked = [];
  for (const level of result.qr18.levels) {
    walked.push(Object.freeze({
      level: level.level,
      id: level.id,
      verified: level.verified === true,
      ...(level.reason === undefined ? {} : { reason: level.reason }),
    }));
    if (level.verified !== true) break;
  }
  return Object.freeze({
    ...result,
    walked: Object.freeze(walked),
  });
}

export function assertSliceAuditFloor({ ladder, slice } = {}) {
  const intact = assertAuditLadderIntact(ladder);
  const workSlices = new Set(['after-inspect', 'after-tests', 'after-file-work', 'after-build', 'slice_end']);
  if (!workSlices.has(slice)) return intact;
  const action = intact.qr18.levels.find((level) => level.id === 'action');
  if (action?.verified !== true) {
    throw new Error(`audit ladder blocked: action proof missing after ${slice}`);
  }
  return intact;
}
