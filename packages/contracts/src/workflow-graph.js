export const WORKFLOW_NODE_KINDS = Object.freeze([
  'goal',
  'subgoal',
  'action',
  'verification_gate',
  'recovery_path',
]);

export const WORKFLOW_EDGE_KINDS = Object.freeze([
  'depends_on',
  'blocks',
  'satisfies',
  'supersedes',
  'retry_after',
  'rollback_to',
  'alternate_path',
]);

const EDGE_KIND_SET = new Set(WORKFLOW_EDGE_KINDS);
const NODE_KIND_SET = new Set(WORKFLOW_NODE_KINDS);

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requiredId(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

/**
 * Normalize legacy `{ prerequisite, dependent }` edges and typed `{ kind, from, to }`
 * edges into one frozen shape. Default kind is `depends_on`.
 */
export function normalizeWorkflowEdges(dependencies = []) {
  if (!Array.isArray(dependencies)) throw new TypeError('dependencies must be an array');
  return Object.freeze(dependencies.map((item, index) => {
    if (!plainObject(item)) throw new TypeError('dependency entry must be an object');
    const kind = typeof item.kind === 'string' && item.kind.trim().length > 0
      ? item.kind.trim()
      : 'depends_on';
    if (!EDGE_KIND_SET.has(kind)) throw new Error(`unsupported workflow edge kind: ${kind}`);
    const from = requiredId(item.from ?? item.prerequisite, 'dependency from/prerequisite');
    const to = requiredId(item.to ?? item.dependent, 'dependency to/dependent');
    if (from === to) throw new Error('workflow edge cannot connect a node to itself');
    return Object.freeze({
      id: typeof item.id === 'string' && item.id.trim().length > 0 ? item.id.trim() : `edge-${index + 1}`,
      kind,
      from,
      to,
      // Preserve legacy field names for existing readers/tests.
      prerequisite: from,
      dependent: to,
    });
  }));
}

function detectCycle(edges) {
  const outgoing = new Map();
  for (const edge of edges) {
    if (edge.kind !== 'depends_on' && edge.kind !== 'blocks') continue;
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
  }
  const visiting = new Set();
  const visited = new Set();
  function walk(node) {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of outgoing.get(node) ?? []) {
      if (walk(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }
  for (const node of outgoing.keys()) {
    if (walk(node)) return true;
  }
  return false;
}

/**
 * Build a persisted workflow/plan graph from the authoritative mission graph fields.
 * Subgoals become subgoal nodes; plan steps also emit action nodes; auditor-named
 * verify steps become verification_gate nodes; optional recovery edges mint
 * recovery_path nodes.
 */
export function buildWorkflowGraph({
  goals = [],
  subgoals = [],
  dependencies = [],
  currentPlan,
} = {}) {
  if (!Array.isArray(goals)) throw new TypeError('goals must be an array');
  if (!Array.isArray(subgoals)) throw new TypeError('subgoals must be an array');
  const edges = normalizeWorkflowEdges(dependencies);
  const nodes = [];
  const nodeIds = new Set();

  function addNode(node) {
    if (!NODE_KIND_SET.has(node.kind)) throw new Error(`unsupported workflow node kind: ${node.kind}`);
    const id = requiredId(node.id, 'node id');
    if (nodeIds.has(id)) throw new Error(`duplicate workflow node id: ${id}`);
    nodeIds.add(id);
    nodes.push(Object.freeze({ ...node, id }));
  }

  for (const goal of goals) {
    if (!plainObject(goal)) throw new TypeError('goal entry must be an object');
    addNode({
      id: requiredId(goal.id, 'goal id'),
      kind: 'goal',
      objective: typeof goal.objective === 'string' ? goal.objective : undefined,
    });
  }
  for (const subgoal of subgoals) {
    if (!plainObject(subgoal)) throw new TypeError('subgoal entry must be an object');
    addNode({
      id: requiredId(subgoal.id, 'subgoal id'),
      kind: 'subgoal',
      goalId: requiredId(subgoal.goalId, 'subgoal goalId'),
      objective: typeof subgoal.objective === 'string' ? subgoal.objective : undefined,
    });
  }

  const planSteps = Array.isArray(currentPlan?.steps) ? currentPlan.steps : [];
  for (const step of planSteps) {
    const id = requiredId(step, 'plan step');
    if (!nodeIds.has(id)) {
      addNode({ id, kind: 'subgoal' });
    }
    const actionId = `action:${id}`;
    if (!nodeIds.has(actionId)) {
      addNode({ id: actionId, kind: 'action', subgoalId: id });
    }
    if (/verify|proof|audit/i.test(id)) {
      const gateId = `gate:${id}`;
      if (!nodeIds.has(gateId)) {
        addNode({ id: gateId, kind: 'verification_gate', subgoalId: id });
      }
    }
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      throw new Error(`workflow edge ${edge.id} references unknown node`);
    }
    if (edge.kind === 'rollback_to' || edge.kind === 'retry_after' || edge.kind === 'alternate_path') {
      const recoveryId = `recovery:${edge.id}`;
      if (!nodeIds.has(recoveryId)) {
        addNode({ id: recoveryId, kind: 'recovery_path', edgeId: edge.id });
      }
    }
  }

  if (detectCycle(edges)) {
    throw new Error('workflow graph contains a depends_on/blocks cycle');
  }

  return Object.freeze({
    version: 1,
    nodes: Object.freeze(nodes),
    edges,
  });
}

/**
 * Path validity: execution remains on a valid mission path given completed/pending/failed work.
 * Acceptance for Item 11 — not merely “is the action legal”, but “is the path still valid”.
 */
export function assessMissionPath({
  workflowGraph,
  completedWork = [],
  pendingWork = [],
  failedWork = [],
} = {}) {
  if (!plainObject(workflowGraph) || !Array.isArray(workflowGraph.edges) || !Array.isArray(workflowGraph.nodes)) {
    return Object.freeze({
      valid: false,
      reason: 'workflow graph missing',
      violations: Object.freeze(['missing_workflow_graph']),
    });
  }
  if (!Array.isArray(completedWork) || !Array.isArray(pendingWork) || !Array.isArray(failedWork)) {
    throw new TypeError('completedWork, pendingWork, and failedWork must be arrays');
  }

  const completed = new Set(completedWork);
  const pending = new Set(pendingWork);
  const failed = new Set(failedWork);
  const violations = [];

  for (const id of completed) {
    if (pending.has(id) || failed.has(id)) {
      violations.push(`partition_overlap:${id}`);
    }
  }
  for (const id of pending) {
    if (failed.has(id)) violations.push(`partition_overlap:${id}`);
  }

  for (const edge of workflowGraph.edges) {
    if (edge.kind === 'depends_on') {
      if (completed.has(edge.to) && !completed.has(edge.from)) {
        violations.push(`depends_on:${edge.to}->requires:${edge.from}`);
      }
    }
    if (edge.kind === 'blocks') {
      // `from` blocks `to` until `from` is completed.
      if (completed.has(edge.to) && !completed.has(edge.from)) {
        violations.push(`blocks:${edge.from}->blocks:${edge.to}`);
      }
    }
    if (edge.kind === 'satisfies') {
      // Informational for goals; if `from` completed, goal `to` is considered addressed.
      // No violation alone — recorded for evidence.
    }
  }

  // Plan order: if plan steps exist as subgoal nodes, earlier incomplete steps cannot
  // be skipped while a later step is completed (unless an alternate_path edge covers it).
  const planActions = workflowGraph.nodes
    .filter((node) => node.kind === 'action' && typeof node.subgoalId === 'string')
    .map((node) => node.subgoalId);
  const alternateTargets = new Set(
    workflowGraph.edges.filter((edge) => edge.kind === 'alternate_path').map((edge) => edge.to),
  );
  for (let index = 0; index < planActions.length; index += 1) {
    const step = planActions[index];
    if (!completed.has(step)) continue;
    for (let earlier = 0; earlier < index; earlier += 1) {
      const prior = planActions[earlier];
      if (completed.has(prior) || failed.has(prior)) continue;
      if (alternateTargets.has(step)) continue;
      // depends_on edges already cover explicit prerequisites; plan-order catches silent skips.
      const hasDepends = workflowGraph.edges.some(
        (edge) => edge.kind === 'depends_on' && edge.from === prior && edge.to === step,
      );
      if (hasDepends || earlier === index - 1) {
        if (!completed.has(prior)) {
          violations.push(`plan_order:${step}->skips:${prior}`);
        }
      }
    }
  }

  const unique = [...new Set(violations)];
  return Object.freeze({
    valid: unique.length === 0,
    reason: unique.length === 0 ? null : unique.join('; '),
    violations: Object.freeze(unique),
    completedCount: completed.size,
    pendingCount: pending.size,
    failedCount: failed.size,
  });
}

export function assertValidMissionPath(input) {
  const assessment = assessMissionPath(input);
  if (assessment.valid !== true) {
    throw new Error(`mission path invalid: ${assessment.reason ?? 'unknown'}`);
  }
  return assessment;
}
