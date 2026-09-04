/**
 * Item 23 — self-improvement sandbox contracts.
 * Never: agent modifies itself → says it is better → production.
 */

export const IMPROVEMENT_STAGES = Object.freeze([
  'propose',
  'sandbox',
  'benchmark',
  'compare_with_frozen_control',
  'security_check',
  'qr18_validation',
  'approve',
  'deploy',
  'monitor',
  'rollback_if_required',
]);

export const IMPROVEMENT_TARGETS = Object.freeze([
  'prompts',
  'workflows',
  'routing_policies',
  'skills',
  'tools',
  'memory_strategy',
  'planning_strategy',
  'agent_implementations',
  'code',
]);

const STAGE_INDEX = Object.freeze(Object.fromEntries(IMPROVEMENT_STAGES.map((stage, index) => [stage, index])));
const TARGET_SET = new Set(IMPROVEMENT_TARGETS);
const APPROVERS = Object.freeze(new Set(['qra_emerge_audit', 'miss-vale-prime']));
const DEPLOYERS = Object.freeze(new Set(['miss-vale-prime', 'qra_emerge_audit']));
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requiredId(value, label) {
  const id = requiredText(value, label);
  if (!SAFE_ID.test(id)) throw new Error(`invalid ${label}`);
  return id;
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function rate(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${label} must be a finite number in 0..1`);
  }
  return value;
}

function nonNegInt(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value;
}

export function assertImprovementStageOrder(fromStage, toStage) {
  const from = requiredText(fromStage, 'fromStage');
  const to = requiredText(toStage, 'toStage');
  if (!(from in STAGE_INDEX) || !(to in STAGE_INDEX)) {
    throw new Error(`unknown improvement stage: ${from} -> ${to}`);
  }
  if (STAGE_INDEX[to] !== STAGE_INDEX[from] + 1) {
    throw new Error(`cannot skip improvement stages: ${from} -> ${to}`);
  }
  return true;
}

export function assertCannotSelfDeclareProduction(payload = {}) {
  plainObject(payload, 'payload');
  if (payload.production === true && (payload.selfDeclaredBetter === true || payload.claim === 'better')) {
    throw new Error('forbidden uncontrolled self-modification: agent cannot self-declare better into production');
  }
  throw new Error('forbidden uncontrolled self-modification path');
}

export function normalizeImprovementProposal(input = {}) {
  const object = plainObject(input, 'proposal');
  const target = requiredText(object.target, 'target');
  if (!TARGET_SET.has(target)) throw new Error(`unsupported improvement target: ${target}`);
  return Object.freeze({
    id: requiredId(object.id, 'proposal id'),
    target,
    summary: requiredText(object.summary, 'summary'),
    change: Object.freeze({ ...plainObject(object.change, 'change') }),
    proposedBy: requiredId(object.proposedBy, 'proposedBy'),
  });
}

export function normalizeImprovementMetrics(input = {}, label = 'metrics') {
  const object = plainObject(input, label);
  return Object.freeze({
    taskSuccessRate: rate(object.taskSuccessRate, `${label}.taskSuccessRate`),
    failedHandoffs: nonNegInt(object.failedHandoffs, `${label}.failedHandoffs`),
    securityFindings: nonNegInt(object.securityFindings, `${label}.securityFindings`),
  });
}

export function compareWithFrozenControl({ control, candidate } = {}) {
  const baseline = normalizeImprovementMetrics(control, 'control');
  const trial = normalizeImprovementMetrics(candidate, 'candidate');
  const improved = trial.taskSuccessRate > baseline.taskSuccessRate
    && trial.failedHandoffs <= baseline.failedHandoffs
    && trial.securityFindings <= baseline.securityFindings;
  const regression = trial.taskSuccessRate < baseline.taskSuccessRate
    || trial.failedHandoffs > baseline.failedHandoffs
    || trial.securityFindings > baseline.securityFindings;
  return Object.freeze({ improved, regression, control: baseline, candidate: trial });
}

export function assertImprovementApprover(actor) {
  const id = requiredId(actor, 'approver');
  if (!APPROVERS.has(id)) throw new Error(`unauthorized improvement approver: ${id}`);
  return id;
}

export function assertImprovementDeployer(actor) {
  const id = requiredId(actor, 'deployer');
  if (!DEPLOYERS.has(id)) throw new Error(`unauthorized improvement deployer: ${id}`);
  return id;
}

export function evaluateImprovementQr18(result = {}) {
  const layers = plainObject(result.layers ?? {}, 'qr18.layers');
  const required = ['action', 'artifact', 'state', 'subgoal', 'workflow', 'mission'];
  const layerOk = required.every((key) => layers[key] === true);
  const verified = result.verified === true && layerOk;
  return Object.freeze({
    verified,
    layers: Object.freeze({ ...layers }),
    reasons: Object.freeze(verified ? [] : [
      ...(result.verified === true ? [] : ['qr18 not verified']),
      ...(layerOk ? [] : ['qr18 layers incomplete']),
    ]),
  });
}
