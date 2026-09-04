import { recordedWorkPerformers } from '../../contracts/src/execution-roles.js';

export const QR18_LEVELS = Object.freeze([
  Object.freeze({ level: 1, id: 'action', name: 'Action proof' }),
  Object.freeze({ level: 2, id: 'artifact', name: 'Artifact proof' }),
  Object.freeze({ level: 3, id: 'state-transition', name: 'State-transition proof' }),
  Object.freeze({ level: 4, id: 'subgoal', name: 'Subgoal proof' }),
  Object.freeze({ level: 5, id: 'workflow', name: 'Workflow proof' }),
  Object.freeze({ level: 6, id: 'mission', name: 'Mission proof' }),
]);

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function levelRecord({ level, id, name, verified, evidence, reason }) {
  return Object.freeze({
    level,
    id,
    name,
    verified: verified === true,
    evidence: Object.freeze(evidence ?? {}),
    ...(reason === undefined ? {} : { reason }),
  });
}

function planSteps(mission) {
  const steps = mission?.currentPlan?.steps;
  if (Array.isArray(steps) && steps.length > 0) {
    return steps.filter((step) => typeof step === 'string' && step.length > 0);
  }
  const subgoals = mission?.subgoals;
  if (Array.isArray(subgoals) && subgoals.length > 0) {
    return subgoals.map((entry) => entry?.id).filter((id) => typeof id === 'string' && id.length > 0);
  }
  return [];
}

function evaluateAction(mission) {
  const evidence = Array.isArray(mission?.evidence) ? mission.evidence : [];
  const performers = evidence
    .map((entry) => (plainObject(entry) ? entry.agent ?? entry.executor : null))
    .filter((value) => typeof value === 'string' && value.length > 0);
  const historyActors = recordedWorkPerformers(mission?.transitionHistory ?? []);
  const verified = evidence.length > 0 || historyActors.length > 0;
  return levelRecord({
    level: 1,
    id: 'action',
    name: 'Action proof',
    verified,
    evidence: {
      evidenceEntries: evidence.length,
      evidenceAgents: Object.freeze(performers),
      recordedPerformers: Object.freeze([...historyActors]),
    },
    ...(verified ? {} : { reason: 'no recorded action evidence' }),
  });
}

function evaluateArtifact(mission) {
  const refs = Array.isArray(mission?.artifactReferences) ? mission.artifactReferences : [];
  const accepted = refs.filter((ref) => plainObject(ref)
    && ref.verified === true
    && typeof ref.artifactHash === 'string'
    && /^[a-f0-9]{64}$/.test(ref.artifactHash)
    && typeof ref.proofHash === 'string'
    && /^[a-f0-9]{64}$/.test(ref.proofHash)
    && plainObject(ref.verifierResult)
    && typeof ref.verifierResult.verifier === 'string'
    && ref.verifierResult.verified === true
    && typeof ref.agent === 'string'
    && typeof ref.action === 'string');
  const verified = accepted.length > 0;
  return levelRecord({
    level: 2,
    id: 'artifact',
    name: 'Artifact proof',
    verified,
    evidence: {
      artifactReferences: refs.length,
      verifiedArtifacts: Object.freeze(accepted.map((ref) => Object.freeze({
        id: ref.id ?? ref.artifactId ?? null,
        artifactHash: ref.artifactHash,
        proofHash: ref.proofHash,
        agent: ref.agent,
        action: ref.action,
        verifier: ref.verifierResult.verifier,
      }))),
    },
    ...(verified ? {} : { reason: 'no verified artifact lineage with producer and verifier' }),
  });
}

function evaluateStateTransition(mission, certifierAgentId, transitionHistory) {
  const performers = new Set(recordedWorkPerformers(transitionHistory ?? mission?.transitionHistory ?? []));
  const certifier = typeof certifierAgentId === 'string' ? certifierAgentId.trim().toLowerCase() : '';
  const independent = certifier.length > 0 && !performers.has(certifier);
  const statusOk = mission?.status === 'running' || mission?.status === 'completed';
  const verified = independent && statusOk;
  return levelRecord({
    level: 3,
    id: 'state-transition',
    name: 'State-transition proof',
    verified,
    evidence: {
      certifierAgentId: certifier || null,
      recordedPerformers: Object.freeze([...performers]),
      independent,
      missionStatus: mission?.status ?? null,
    },
    ...(verified ? {} : {
      reason: !independent
        ? 'certifier is a recorded work performer'
        : 'mission is not in a certifiable running/completed state',
    }),
  });
}

function evaluateSubgoal(mission) {
  const steps = planSteps(mission);
  const completed = Array.isArray(mission?.completedWork) ? mission.completedWork : [];
  const missing = steps.filter((step) => !completed.includes(step));
  const verified = steps.length > 0 && missing.length === 0;
  return levelRecord({
    level: 4,
    id: 'subgoal',
    name: 'Subgoal proof',
    verified,
    evidence: {
      planSteps: Object.freeze(steps),
      completedWork: Object.freeze([...completed]),
      missing: Object.freeze(missing),
    },
    ...(verified ? {} : {
      reason: steps.length === 0 ? 'mission has no plan steps or subgoals' : `missing completedWork: ${missing.join(',')}`,
    }),
  });
}

function evaluateWorkflow(mission) {
  const completed = new Set(Array.isArray(mission?.completedWork) ? mission.completedWork : []);
  const pending = Array.isArray(mission?.pendingWork) ? mission.pendingWork : [];
  const failed = Array.isArray(mission?.failedWork) ? mission.failedWork : [];
  const dependencies = Array.isArray(mission?.dependencies) ? mission.dependencies : [];
  const broken = [];
  for (const edge of dependencies) {
    if (!plainObject(edge)) continue;
    const prerequisite = edge.prerequisite;
    const dependent = edge.dependent;
    if (typeof prerequisite !== 'string' || typeof dependent !== 'string') continue;
    if (completed.has(dependent) && !completed.has(prerequisite)) {
      broken.push(`${dependent} without ${prerequisite}`);
    }
  }
  const verified = pending.length === 0 && failed.length === 0 && broken.length === 0 && completed.size > 0;
  return levelRecord({
    level: 5,
    id: 'workflow',
    name: 'Workflow proof',
    verified,
    evidence: {
      pendingWork: Object.freeze([...pending]),
      failedWork: Object.freeze([...failed]),
      dependencyViolations: Object.freeze(broken),
      completedCount: completed.size,
    },
    ...(verified ? {} : {
      reason: broken.length > 0
        ? `dependency violations: ${broken.join(';')}`
        : pending.length > 0
          ? 'pendingWork is not empty'
          : failed.length > 0
            ? 'failedWork is not empty'
            : 'no completed work on the workflow path',
    }),
  });
}

function evaluateMission(mission, proofVerification) {
  const proofOk = plainObject(proofVerification)
    && proofVerification.verified === true
    && typeof proofVerification.sha256 === 'string'
    && /^[a-f0-9]{64}$/.test(proofVerification.sha256);
  const objective = typeof mission?.objective === 'string' && mission.objective.trim().length > 0
    ? mission.objective
    : (typeof mission?.intent === 'string' ? mission.intent : '');
  const verified = proofOk && objective.trim().length > 0;
  return levelRecord({
    level: 6,
    id: 'mission',
    name: 'Mission proof',
    verified,
    evidence: {
      proofVerified: proofOk,
      proofSha256: proofOk ? proofVerification.sha256 : null,
      objective: objective.trim().length > 0 ? objective.trim() : null,
    },
    ...(verified ? {} : {
      reason: !proofOk ? 'mission proof verification failed' : 'mission objective/intent missing',
    }),
  });
}

/**
 * Item 10 / QR18 layered verification.
 *
 * Evaluates Levels 1–6 against the authoritative mission snapshot (including any
 * proposed completion update already merged) plus the service-verified proof
 * result. Returns structured per-level evidence — never a bare PASS/FAIL.
 *
 * Caller-supplied qr18 bags are irrelevant; this function is the authority.
 */
export function evaluateQr18Layers({
  mission,
  proofVerification,
  certifierAgentId,
  transitionHistory,
} = {}) {
  if (!plainObject(mission)) throw new TypeError('mission is required for QR18 layered verification');

  const levels = Object.freeze([
    evaluateAction(mission),
    evaluateArtifact(mission),
    evaluateStateTransition(mission, certifierAgentId, transitionHistory),
    evaluateSubgoal(mission),
    evaluateWorkflow(mission),
    evaluateMission(mission, proofVerification),
  ]);

  const failed = levels.filter((entry) => entry.verified !== true).map((entry) => entry.id);
  return Object.freeze({
    verifier: 'qr18',
    verified: failed.length === 0,
    levels,
    failedLevels: Object.freeze(failed),
  });
}

export function assertQr18LayersVerified(qr18) {
  if (!plainObject(qr18) || qr18.verifier !== 'qr18') {
    throw new Error('QR18 layered verification missing: completion requires structured qr18 evidence');
  }
  if (!Array.isArray(qr18.levels) || qr18.levels.length !== QR18_LEVELS.length) {
    throw new Error('QR18 layered verification incomplete: expected six levels');
  }
  if (qr18.verified !== true) {
    const failed = Array.isArray(qr18.failedLevels) ? qr18.failedLevels.join(',') : 'unknown';
    throw new Error(`QR18 layered verification failed: ${failed}`);
  }
  return qr18;
}
