import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORKFLOW_EDGE_KINDS,
  WORKFLOW_NODE_KINDS,
  assessMissionPath,
  assertValidMissionPath,
  buildWorkflowGraph,
  normalizeWorkflowEdges,
} from '../../packages/contracts/src/workflow-graph.js';

const titanParts = {
  goals: [{ id: 'validate-titan', objective: 'Verify the complete Titan runtime' }],
  subgoals: [
    { id: 'inspect-repository', goalId: 'validate-titan', objective: 'Inspect the repository state' },
    { id: 'run-node-tests', goalId: 'validate-titan', objective: 'Execute the Node test suite' },
    { id: 'verify-proof', goalId: 'validate-titan', objective: 'Verify proof-bound completion' },
  ],
  dependencies: [
    { prerequisite: 'inspect-repository', dependent: 'run-node-tests' },
    { prerequisite: 'run-node-tests', dependent: 'verify-proof' },
  ],
  currentPlan: { id: 'titan-test-plan', version: 1, steps: ['inspect-repository', 'run-node-tests', 'verify-proof'] },
};

test('workflow graph exposes the Item 11 node and edge vocabularies', () => {
  assert.deepEqual([...WORKFLOW_NODE_KINDS].sort(), [
    'action', 'goal', 'recovery_path', 'subgoal', 'verification_gate',
  ].sort());
  assert.deepEqual([...WORKFLOW_EDGE_KINDS].sort(), [
    'alternate_path', 'blocks', 'depends_on', 'retry_after', 'rollback_to', 'satisfies', 'supersedes',
  ].sort());
});

test('buildWorkflowGraph persists goals, subgoals, actions, gates, and depends_on edges', () => {
  const graph = buildWorkflowGraph(titanParts);
  assert.equal(graph.version, 1);
  const kinds = Object.fromEntries(
    WORKFLOW_NODE_KINDS.map((kind) => [kind, graph.nodes.filter((node) => node.kind === kind).length]),
  );
  assert.equal(kinds.goal, 1);
  assert.equal(kinds.subgoal, 3);
  assert.equal(kinds.action, 3);
  assert.equal(kinds.verification_gate, 1);
  assert.ok(graph.edges.every((edge) => edge.kind === 'depends_on'));
  assert.equal(graph.edges.length, 2);
  assert.equal(graph.edges[0].from, 'inspect-repository');
  assert.equal(graph.edges[0].to, 'run-node-tests');
  assert.equal(graph.edges[0].prerequisite, 'inspect-repository');
  assert.equal(graph.edges[0].dependent, 'run-node-tests');
});

test('normalizeWorkflowEdges accepts typed kinds and rejects unknown kinds', () => {
  const edges = normalizeWorkflowEdges([
    { kind: 'blocks', from: 'quarantine', to: 'deploy' },
    { kind: 'satisfies', from: 'verify-proof', to: 'validate-titan' },
  ]);
  assert.deepEqual(edges.map(({ kind }) => kind), ['blocks', 'satisfies']);
  assert.throws(
    () => normalizeWorkflowEdges([{ kind: 'feels_ok', from: 'a', to: 'b' }]),
    /unsupported workflow edge kind/i,
  );
});

test('buildWorkflowGraph rejects depends_on cycles', () => {
  assert.throws(
    () => buildWorkflowGraph({
      goals: [{ id: 'g', objective: 'g' }],
      subgoals: [
        { id: 'a', goalId: 'g', objective: 'a' },
        { id: 'b', goalId: 'g', objective: 'b' },
      ],
      dependencies: [
        { prerequisite: 'a', dependent: 'b' },
        { prerequisite: 'b', dependent: 'a' },
      ],
      currentPlan: { id: 'p', version: 1, steps: ['a', 'b'] },
    }),
    /cycle/i,
  );
});

test('assessMissionPath accepts an in-order completed prefix', () => {
  const graph = buildWorkflowGraph(titanParts);
  const assessment = assessMissionPath({
    workflowGraph: graph,
    completedWork: ['inspect-repository'],
    pendingWork: ['run-node-tests', 'verify-proof'],
    failedWork: [],
  });
  assert.equal(assessment.valid, true);
  assertValidMissionPath({
    workflowGraph: graph,
    completedWork: ['inspect-repository', 'run-node-tests', 'verify-proof'],
    pendingWork: [],
    failedWork: [],
  });
});

test('assessMissionPath rejects completing a dependent before its depends_on prerequisite', () => {
  const graph = buildWorkflowGraph(titanParts);
  const assessment = assessMissionPath({
    workflowGraph: graph,
    completedWork: ['run-node-tests'],
    pendingWork: ['inspect-repository', 'verify-proof'],
    failedWork: [],
  });
  assert.equal(assessment.valid, false);
  assert.match(assessment.reason, /depends_on:run-node-tests->requires:inspect-repository/);
  assert.throws(
    () => assertValidMissionPath({
      workflowGraph: graph,
      completedWork: ['run-node-tests'],
      pendingWork: ['inspect-repository', 'verify-proof'],
      failedWork: [],
    }),
    /mission path invalid/i,
  );
});

test('assessMissionPath rejects blocked work completed while the blocker is incomplete', () => {
  const graph = buildWorkflowGraph({
    goals: [{ id: 'g', objective: 'g' }],
    subgoals: [
      { id: 'hold', goalId: 'g', objective: 'hold' },
      { id: 'ship', goalId: 'g', objective: 'ship' },
    ],
    dependencies: [{ kind: 'blocks', from: 'hold', to: 'ship' }],
    currentPlan: { id: 'p', version: 1, steps: ['hold', 'ship'] },
  });
  const assessment = assessMissionPath({
    workflowGraph: graph,
    completedWork: ['ship'],
    pendingWork: ['hold'],
    failedWork: [],
  });
  assert.equal(assessment.valid, false);
  assert.match(assessment.reason, /blocks:hold->blocks:ship/);
});

test('missing workflow graph is an invalid path', () => {
  const assessment = assessMissionPath({
    workflowGraph: null,
    completedWork: ['inspect'],
    pendingWork: [],
    failedWork: [],
  });
  assert.equal(assessment.valid, false);
  assert.match(assessment.reason, /workflow graph missing/);
});
