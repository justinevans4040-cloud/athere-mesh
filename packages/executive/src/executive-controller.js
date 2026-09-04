/**
 * Item 16 — Executive Controller.
 * Advises next strategy from authoritative mission state only.
 * Does not mutate missions, certify success, or bypass MEA/path gates.
 */

import { roleForAgent } from '../../contracts/src/execution-roles.js';

export const EXECUTIVE_ACTIONS = Object.freeze([
  'allocate_work',
  'verify',
  'retry',
  'change_strategy',
  'stop',
  'escalate_human',
  'research',
]);

export const EXECUTIVE_ACTORS = Object.freeze([
  'mission-state-service',
  'orchestrator',
  'miss-vale-prime',
]);

const ACTION_SET = new Set(EXECUTIVE_ACTIONS);
const ACTOR_SET = new Set(EXECUTIVE_ACTORS);

const WORK_AGENT = Object.freeze({
  'inspect-repository': 'nyx',
  'run-node-tests': 'rune',
  'verify-proof': 'qra_emerge_audit',
});

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export function assertExecutiveActor(actor) {
  const id = requiredText(actor, 'executive actor');
  if (!ACTOR_SET.has(id)) throw new Error(`unauthorized executive actor: ${id}`);
  return id;
}

function nextPendingWork(mission) {
  const pending = Array.isArray(mission.pendingWork) ? mission.pendingWork : [];
  const plan = Array.isArray(mission.currentPlan?.steps) ? mission.currentPlan.steps : [];
  for (const step of plan) {
    if (pending.includes(step)) return step;
  }
  return pending[0] ?? null;
}

function hasVerifiedCheckpoint(mission) {
  return (mission.checkpoints ?? []).some((entry) => entry?.verified === true && entry.stateHash);
}

function latestCheckpointId(mission) {
  const verified = (mission.checkpoints ?? []).filter((entry) => entry?.verified === true && entry.stateHash);
  return verified.at(-1)?.id ?? null;
}

function uncertaintyFor(mission) {
  if (mission.status === 'blocked') return 'high';
  if ((mission.failedWork ?? []).length > 0) return 'high';
  if ((mission.evidence ?? []).length === 0 && (mission.pendingWork ?? []).length > 0) return 'medium';
  if (mission.status === 'completed') return 'low';
  return 'medium';
}

function enoughInformation(mission, nextWork) {
  if (!nextWork) return true;
  if (nextWork === 'inspect-repository') return true;
  if (nextWork === 'run-node-tests') {
    return (mission.completedWork ?? []).includes('inspect-repository');
  }
  if (nextWork === 'verify-proof') {
    return (mission.completedWork ?? []).includes('run-node-tests')
      && (mission.evidence ?? []).length > 0;
  }
  return (mission.evidence ?? []).length > 0;
}

function decisionRecord(fields) {
  const nextAction = requiredText(fields.nextAction, 'nextAction');
  if (!ACTION_SET.has(nextAction)) throw new Error(`unsupported executive action: ${nextAction}`);
  return Object.freeze({
    nextAction,
    nextWork: fields.nextWork ?? null,
    enoughInformation: fields.enoughInformation === true,
    uncertainty: fields.uncertainty ?? 'unknown',
    researchRequired: fields.researchRequired === true,
    model: fields.model ?? 'none',
    agentId: fields.agentId ?? null,
    specialistRequired: fields.specialistRequired === true,
    budget: Object.freeze(fields.budget ?? { max_state_mutations: 0 }),
    strategyChange: fields.strategyChange ? Object.freeze(structuredClone(fields.strategyChange)) : null,
    stop: fields.stop === true,
    humanInterventionRequired: fields.humanInterventionRequired === true,
    canCertifySuccess: false,
    mutatesMission: false,
    mutateCompletedWork: null,
    integrityPreserved: true,
    rationale: Object.freeze([...(fields.rationale ?? [])]),
  });
}

export function assertExecutivePreservesIntegrity(decision, mission) {
  if (!plainObject(decision) || !plainObject(mission)) {
    throw new TypeError('decision and mission are required');
  }
  if (decision.canCertifySuccess === true) {
    throw new Error('mission integrity: executive cannot certify success');
  }
  if (decision.mutatesMission === true) {
    throw new Error('mission integrity: executive cannot mutate mission state directly');
  }
  if (Array.isArray(decision.mutateCompletedWork) && decision.mutateCompletedWork.length > 0) {
    throw new Error('mission integrity: executive cannot advance completedWork');
  }
  if (decision.agentId) {
    const role = roleForAgent(decision.agentId);
    if (role === 'executor' && decision.nextAction === 'verify') {
      throw new Error('mission integrity: executor cannot verify');
    }
  }
  if (typeof decision.nextWork === 'string' && decision.nextWork.length > 0) {
    const completed = mission.completedWork ?? [];
    const plan = mission.currentPlan?.steps ?? [];
    const index = plan.indexOf(decision.nextWork);
    if (index > 0) {
      const prior = plan.slice(0, index);
      const priorDone = prior.every((step) => completed.includes(step));
      if (!priorDone) {
        throw new Error('mission integrity: executive cannot skip mission path');
      }
    }
  }
  if (decision.strategyChange) {
    const action = decision.strategyChange.action;
    if (!['quarantine_branch', 'retry_from_checkpoint', 'create_branch', 'rollback_to_checkpoint'].includes(action)) {
      throw new Error('mission integrity: unsupported strategy change');
    }
    if (decision.agentId !== 'qra_recovery_driver') {
      throw new Error('mission integrity: strategy change requires recovery driver');
    }
  }
  if (decision.integrityPreserved !== true) {
    throw new Error('mission integrity: integrityPreserved must be true');
  }
  return true;
}

export function decideNext({ mission, actor = 'mission-state-service', budget } = {}) {
  assertExecutiveActor(actor);
  if (!plainObject(mission) || typeof mission.id !== 'string') {
    throw new TypeError('mission is required for executive decision');
  }

  if (mission.status === 'completed') {
    const decision = decisionRecord({
      nextAction: 'stop',
      stop: true,
      enoughInformation: true,
      uncertainty: 'low',
      agentId: 'miss-vale-prime',
      budget: budget ?? { max_state_mutations: 0 },
      rationale: ['mission_completed'],
    });
    assertExecutivePreservesIntegrity(decision, mission);
    return decision;
  }

  if (mission.status === 'blocked') {
    const checkpointId = latestCheckpointId(mission);
    const activeBranchId = mission.activeBranchId;
    const quarantineFirst = typeof activeBranchId === 'string'
      && activeBranchId !== 'main'
      && (mission.branches ?? []).some((branch) => branch.id === activeBranchId && branch.status === 'active');

    let strategyChange;
    if (quarantineFirst) {
      strategyChange = {
        action: 'quarantine_branch',
        branchId: activeBranchId,
        then: checkpointId ? { action: 'retry_from_checkpoint', checkpointId } : { action: 'create_branch', checkpointId },
      };
    } else if (checkpointId) {
      strategyChange = {
        action: 'retry_from_checkpoint',
        checkpointId,
      };
    } else if (hasVerifiedCheckpoint(mission) === false && checkpointId === null) {
      const decision = decisionRecord({
        nextAction: 'escalate_human',
        stop: true,
        enoughInformation: false,
        uncertainty: 'high',
        humanInterventionRequired: true,
        researchRequired: true,
        agentId: 'miss-vale-prime',
        budget: budget ?? { max_state_mutations: 0 },
        rationale: ['blocked_without_checkpoint'],
      });
      assertExecutivePreservesIntegrity(decision, mission);
      return decision;
    }

    const decision = decisionRecord({
      nextAction: 'change_strategy',
      enoughInformation: true,
      uncertainty: 'high',
      agentId: 'qra_recovery_driver',
      strategyChange,
      budget: budget ?? { max_state_mutations: 1 },
      rationale: ['blocked_mission', 'preserve_completed_work', 'recovery_strategy'],
    });
    assertExecutivePreservesIntegrity(decision, mission);
    return decision;
  }

  if ((mission.failedWork ?? []).length > 0 && mission.status === 'running') {
    const checkpointId = latestCheckpointId(mission);
    if (checkpointId) {
      const decision = decisionRecord({
        nextAction: 'retry',
        enoughInformation: true,
        uncertainty: 'high',
        agentId: 'qra_recovery_driver',
        strategyChange: { action: 'retry_from_checkpoint', checkpointId },
        budget: budget ?? { max_state_mutations: 1 },
        rationale: ['failed_work_present'],
      });
      assertExecutivePreservesIntegrity(decision, mission);
      return decision;
    }
  }

  const nextWork = nextPendingWork(mission);
  if (!nextWork) {
    if ((mission.completedWork ?? []).length > 0) {
      const decision = decisionRecord({
        nextAction: 'verify',
        nextWork: 'verify-proof',
        enoughInformation: (mission.evidence ?? []).length > 0,
        uncertainty: uncertaintyFor(mission),
        researchRequired: (mission.evidence ?? []).length === 0,
        agentId: 'qra_emerge_audit',
        model: 'none',
        budget: budget ?? { max_state_mutations: 0 },
        rationale: ['no_pending_work', 'auditor_verify'],
      });
      assertExecutivePreservesIntegrity(decision, mission);
      return decision;
    }
    const decision = decisionRecord({
      nextAction: 'escalate_human',
      stop: true,
      enoughInformation: false,
      uncertainty: 'high',
      humanInterventionRequired: true,
      agentId: 'miss-vale-prime',
      budget: budget ?? { max_state_mutations: 0 },
      rationale: ['no_work_available'],
    });
    assertExecutivePreservesIntegrity(decision, mission);
    return decision;
  }

  const informed = enoughInformation(mission, nextWork);
  if (!informed) {
    const decision = decisionRecord({
      nextAction: 'research',
      nextWork,
      enoughInformation: false,
      uncertainty: 'high',
      researchRequired: true,
      agentId: 'miss-vale-prime',
      specialistRequired: false,
      model: 'none',
      budget: budget ?? { max_state_mutations: 0 },
      rationale: ['insufficient_information', nextWork],
    });
    assertExecutivePreservesIntegrity(decision, mission);
    return decision;
  }

  const agentId = WORK_AGENT[nextWork] ?? 'miss-vale-prime';
  const nextAction = agentId === 'qra_emerge_audit' ? 'verify' : 'allocate_work';
  const decision = decisionRecord({
    nextAction,
    nextWork,
    enoughInformation: true,
    uncertainty: uncertaintyFor(mission),
    researchRequired: false,
    agentId,
    specialistRequired: !WORK_AGENT[nextWork],
    model: 'none',
    budget: budget ?? { max_state_mutations: 0 },
    rationale: ['authoritative_pending_work', nextWork, agentId],
  });
  assertExecutivePreservesIntegrity(decision, mission);
  return decision;
}
