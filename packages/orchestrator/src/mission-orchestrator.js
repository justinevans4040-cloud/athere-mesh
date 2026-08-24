import { randomUUID } from 'node:crypto';
import { planCommand } from '../../command/src/command-planner.js';
import { createMission, transitionMission } from '../../contracts/src/mission.js';
import { loadMission, saveMission } from '../../mission/src/mission-store.js';
import { writeProof, verifyProof } from '../../proof/src/proof-store.js';
import { inspectRecovery } from '../../recovery/src/recovery-coordinator.js';
import { createMemoryResonanceBus } from '../../resonance/src/resonance-bus.js';

function requirePath(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${label} is required`);
  return value;
}

function missionId(idFactory) {
  const id = String(idFactory()).replace(/[{}]/g, '');
  return `mission-${id}`;
}

function executorForTests(executor) {
  if (!executor || typeof executor.inspect !== 'function' || typeof executor.runTests !== 'function') {
    throw new TypeError('executor must provide inspect and runTests');
  }
  return executor;
}

function testCounts(result) {
  return Object.freeze({
    tests: result.tests,
    passed: result.passed,
    failed: result.failed,
    skipped: result.skipped,
  });
}

function failureMessage(result) {
  return `node test execution failed: exit code ${result.exitCode}, failed ${result.failed}`;
}

export function createMissionOrchestrator({
  root,
  repositoryRoot,
  bus = createMemoryResonanceBus(),
  executor,
  clock = () => new Date().toISOString(),
  idFactory = randomUUID,
} = {}) {
  const workspaceRoot = requirePath(root, 'root');
  requirePath(repositoryRoot, 'repositoryRoot');
  if (!bus || typeof bus.publish !== 'function') throw new TypeError('bus must provide publish');
  const testExecutor = executorForTests(executor);

  let signalSequence = 0;
  async function publish(signal) {
    signalSequence += 1;
    await bus.publish({
      id: `${signal.missionId}-signal-${signalSequence}`,
      missionId: signal.missionId,
      type: signal.type,
      agent: signal.agent,
      at: signal.at,
      ...(signal.detail ? { detail: signal.detail } : {}),
      ...(signal.proof ? { proof: signal.proof } : {}),
    });
  }

  async function persist(mission, expectedRevision) {
    const record = await saveMission({ root: workspaceRoot, mission, ...(expectedRevision === undefined ? {} : { expectedRevision }) });
    await publish(mission.signals.at(-1));
    return record;
  }

  async function block(mission, revision, detail) {
    const blocked = transitionMission(mission, { type: 'blocked', agent: 'qra_recovery_driver', detail }, { clock });
    const record = await persist(blocked, revision);
    return { revision: record.revision, mission: record.mission };
  }

  return Object.freeze({
    async execute({ profile, text }) {
      const plan = planCommand({ profile, text });
      if (plan.status !== 'ready') return plan;
      if (plan.action.kind !== 'test') {
        return Object.freeze({ status: 'blocked', reason: `no operational executor for ${plan.action.kind}` });
      }

      const accepted = createMission({ id: missionId(idFactory), intent: text, clock });
      let record = await persist(accepted);
      const running = transitionMission(record.mission, {
        type: 'running', agent: 'miss-vale-prime', detail: 'mission supervision started',
      }, { clock });
      record = await persist(running, record.revision);

      try {
        const inspection = await testExecutor.inspect({ repositoryRoot });
        await publish({
          missionId: record.mission.id,
          type: 'running',
          agent: 'nyx',
          at: clock(),
          detail: 'repository inspection completed',
        });
        const result = await testExecutor.runTests({ repositoryRoot });
        await publish({
          missionId: record.mission.id,
          type: 'running',
          agent: 'rune',
          at: clock(),
          detail: 'node test execution completed',
        });
        if (result.exitCode !== 0 || result.failed !== 0) throw new Error(failureMessage(result));

        const ref = await writeProof({
          root: workspaceRoot,
          missionId: record.mission.id,
          payload: {
            command: result.command,
            exitCode: result.exitCode,
            tests: testCounts(result),
            stdout: result.stdout,
            stderr: result.stderr,
            inspection,
          },
        });
        const verification = await verifyProof({ root: workspaceRoot, ref });
        if (verification.verified !== true) throw new Error(`proof verification failed: ${verification.reason ?? 'unknown'}`);
        const completed = transitionMission(record.mission, {
          type: 'completed',
          agent: 'qra_emerge_audit',
          proof: { ...ref, verified: verification.verified },
        }, { clock });
        record = await persist(completed, record.revision);
        return Object.freeze({ revision: record.revision, mission: record.mission, tests: testCounts(result) });
      } catch (error) {
        return block(record.mission, record.revision, error instanceof Error ? error.message : String(error));
      }
    },

    async getMission({ missionId: id }) {
      return loadMission({ root: workspaceRoot, missionId: id });
    },

    async recover() {
      const inspection = await inspectRecovery({ root: workspaceRoot });
      const recovered = [];
      for (const item of inspection.resumable) {
        const record = await loadMission({ root: workspaceRoot, missionId: item.missionId });
        const result = await block(record.mission, record.revision, 'interrupted execution requires operator retry');
        recovered.push({ missionId: result.mission.id, revision: result.revision });
      }
      return Object.freeze({ recovered: Object.freeze(recovered), blocked: inspection.blocked, corrupt: inspection.corrupt });
    },

  });
}
