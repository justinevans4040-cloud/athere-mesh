import { writeFrozenEvaluation } from './evaluation-harness.js';
import { collectEvaluationCohort } from './evaluation-runner.js';

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
    runTask: ({ task }) => executor.runTests({ testFiles: task.args }),
  });
  const reference = await writeFrozen({ root, cohort });
  return Object.freeze({ ...reference, cohort });
}
