import { createHash } from 'node:crypto';
import { parseAgentEnvelope } from '../../contracts/src/agent-envelope.js';
import { parseNodeTestExecutionResult } from '../../contracts/src/execution-results.js';
import { nodeExecutionInputBinding } from '../../execution/src/node-test-executor.js';
import { writeFrozenEvaluation } from './evaluation-harness.js';
import { collectEvaluationCohort } from './evaluation-runner.js';

function controlOperationId(cohortId, trialIndex, taskId) {
  const digest = createHash('sha256')
    .update(`${cohortId}\0${trialIndex}\0${taskId}`)
    .digest('hex')
    .slice(0, 32);
  return `control-${digest}`;
}

function executionEnvelope({ root, cohortId, task, trialIndex, createdAt }) {
  return parseAgentEnvelope({
    mission_id: `evaluation-${cohortId}`,
    task_id: 'run-node-tests',
    operation_id: controlOperationId(cohortId, trialIndex, task.id),
    agent_id: 'rune',
    capability_id: 'node-test-runner',
    state_version: trialIndex + 1,
    objective: `Execute pinned evaluation task ${task.id}`,
    allowed_actions: ['execute_node_tests'],
    required_inputs: [
      'repository_root',
      nodeExecutionInputBinding({ repositoryRoot: root, operation: 'test', testFiles: task.args }),
    ],
    evidence_requirements: ['terminal Node test summary'],
    timeout: 300_000,
    resource_budget: { max_processes: 1, max_output_bytes: 1_048_576 },
    expected_output_schema: {
      type: 'object',
      required: ['command', 'exitCode', 'tests', 'passed', 'failed', 'skipped', 'stdout', 'stderr'],
    },
    completion_conditions: ['test process exits and complete totals are parsed'],
    error_state: null,
    provenance: { requested_by: 'evaluation-harness', created_at: createdAt },
  });
}

export async function collectAndFreezeNodeControl({
  root,
  cohortId,
  suite,
  systemVersion,
  repetitions,
  seed,
  nodeVersion,
  platform,
  executor,
  now = Date.now,
  clock = () => new Date().toISOString(),
  writeFrozen = writeFrozenEvaluation,
} = {}) {
  if (!suite || typeof suite.id !== 'string' || !Array.isArray(suite.tasks) || suite.tasks.length === 0) {
    throw new TypeError('suite must define an id and tasks');
  }
  if (!executor || typeof executor.runTests !== 'function') throw new TypeError('executor must provide runTests');
  const tasks = suite.tasks.map((task) => ({ id: task.id, args: [task.file] }));
  const cohort = await collectEvaluationCohort({
    id: cohortId,
    suiteId: suite.id,
    systemVersion,
    repetitions,
    seed,
    model: { provider: 'none', name: 'deterministic-node', version: nodeVersion },
    environment: { id: `${platform}-node`, version: nodeVersion, deterministic: true },
    tasks,
    now,
    runTask: async ({ task, trialIndex }) => parseNodeTestExecutionResult(await executor.runTests({
      envelope: executionEnvelope({ root, cohortId, task, trialIndex, createdAt: clock() }),
      testFiles: task.args,
    })),
  });
  const reference = await writeFrozen({ root, cohort });
  return Object.freeze({ ...reference, cohort });
}
