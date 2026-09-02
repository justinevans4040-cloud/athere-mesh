import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { planCommand } from '../../command/src/command-planner.js';
import { createMissionStateService } from '../../mission/src/mission-state-service.js';
import { writeArtifactProof, writeProof, verifyArtifactProof, verifyProof } from '../../proof/src/proof-store.js';
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
  const missionState = createMissionStateService({ root: workspaceRoot, clock });

  let signalSequence = 0;
  async function publish(signal) {
    signalSequence += 1;
    try {
      await bus.publish({
        id: `${signal.missionId}-signal-${signalSequence}`,
        missionId: signal.missionId,
        type: signal.type,
        agent: signal.agent,
        at: signal.at,
        ...(signal.detail ? { detail: signal.detail } : {}),
        ...(signal.proof ? { proof: signal.proof } : {}),
      });
    } catch {
      return false;
    }
    return true;
  }

  async function persistTransition(record, signal, update = {}) {
    const saved = await missionState.transition({
      missionId: record.mission.id,
      expectedRevision: record.revision,
      signal,
      update,
    });
    await publish(saved.mission.signals.at(-1));
    return saved;
  }

  async function createAuthoritativeMission({ id, objective }) {
    const record = await missionState.create({
      id,
      objective,
      goals: [{ id: 'validate-titan', objective: 'Verify the complete Titan runtime' }],
      subgoals: [
        { id: 'inspect-repository', objective: 'Inspect the repository state', goalId: 'validate-titan' },
        { id: 'run-node-tests', objective: 'Execute the Node test suite', goalId: 'validate-titan' },
        { id: 'verify-proof', objective: 'Verify proof-bound completion', goalId: 'validate-titan' },
      ],
      dependencies: [
        { prerequisite: 'inspect-repository', dependent: 'run-node-tests' },
        { prerequisite: 'run-node-tests', dependent: 'verify-proof' },
      ],
      constraints: ['completion requires independently verified proof', 'model output is advisory only'],
      permissions: [
        { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
        { actor: 'nyx', actions: ['observe_repository'] },
        { actor: 'rune', actions: ['execute_node_tests'] },
        { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
        { actor: 'qra_recovery_driver', actions: ['block_interrupted_mission'] },
      ],
      currentPlan: { id: 'titan-test-plan', version: 1, steps: ['inspect-repository', 'run-node-tests', 'verify-proof'] },
      environmentObservations: [{ source: 'titan', key: 'repository_root', value: repositoryRoot, observedAt: clock() }],
    });
    await publish(record.mission.signals.at(-1));
    return record;
  }

  async function block(record, detail) {
    const blocked = await persistTransition(record, { type: 'blocked', agent: 'qra_recovery_driver', detail }, {
      activeAgents: [],
      failedWork: record.mission.pendingWork ?? [],
      pendingWork: [],
    });
    return { revision: blocked.revision, mission: blocked.mission };
  }

  return Object.freeze({
    async execute({ profile, text }) {
      const plan = planCommand({ profile, text });
      if (plan.status !== 'ready') return plan;
      if (plan.action.kind !== 'test') {
        return Object.freeze({ status: 'blocked', reason: `no operational executor for ${plan.action.kind}` });
      }

      let record = await createAuthoritativeMission({ id: missionId(idFactory), objective: text });
      record = await persistTransition(record, {
        type: 'running', agent: 'miss-vale-prime', detail: 'mission supervision started',
      }, { activeAgents: ['miss-vale-prime'] });

      try {
        const inspection = await testExecutor.inspect({ repositoryRoot });
        const nyxEvidence = Object.freeze({ executor: 'repository-inspector', result: inspection });
        record = await persistTransition(record, {
          type: 'running',
          agent: 'nyx',
          detail: 'repository inspection completed',
          evidence: nyxEvidence,
        }, {
          completedWork: ['inspect-repository'],
          pendingWork: ['run-node-tests', 'verify-proof'],
          evidence: [{ agent: 'nyx', ...nyxEvidence }],
          activeAgents: ['nyx'],
        });
        const result = await testExecutor.runTests({ repositoryRoot });
        const validatedCounts = testCounts(result);
        const runeResult = Object.freeze({ command: result.command, exitCode: result.exitCode, ...validatedCounts });
        const runeEvidence = Object.freeze({ executor: 'node-test-runner', result: runeResult });
        record = await persistTransition(record, {
          type: 'running',
          agent: 'rune',
          detail: 'node test execution completed',
          evidence: runeEvidence,
        }, {
          completedWork: ['inspect-repository', 'run-node-tests'],
          pendingWork: ['verify-proof'],
          evidence: [...record.mission.evidence, { agent: 'rune', ...runeEvidence }],
          activeAgents: ['rune'],
        });
        if (result.exitCode !== 0 || result.failed !== 0) throw new Error(failureMessage(result));

        const agentEvidence = Object.freeze([
          Object.freeze({ agent: 'nyx', ...nyxEvidence }),
          Object.freeze({ agent: 'rune', ...runeEvidence }),
        ]);
        const ref = await writeProof({
          root: workspaceRoot,
          missionId: record.mission.id,
          payload: {
            command: result.command,
            exitCode: result.exitCode,
            tests: validatedCounts,
            stdout: result.stdout,
            stderr: result.stderr,
            inspection,
            agentEvidence,
          },
        });
        const verification = await verifyProof({ root: workspaceRoot, ref });
        if (verification.verified !== true) throw new Error(`proof verification failed: ${verification.reason ?? 'unknown'}`);
        const proofBytes = await readFile(path.resolve(workspaceRoot, ...ref.path.split('/')));
        const verifierResult = Object.freeze({
          verifier: 'qra_emerge_audit',
          verified: true,
          proofSha256: ref.sha256,
        });
        const artifactRef = await writeArtifactProof({
          root: workspaceRoot,
          missionId: record.mission.id,
          artifactId: 'mission-proof',
          artifact: proofBytes,
          predecessorHash: null,
          agent: 'qra_emerge_audit',
          action: 'verified_mission_proof',
          verifierResult,
          missionStateVersion: record.revision,
          timestamp: clock(),
        });
        const artifactVerification = await verifyArtifactProof({ root: workspaceRoot, ref: artifactRef, artifact: proofBytes });
        if (artifactVerification.verified !== true) {
          throw new Error(`artifact provenance verification failed: ${artifactVerification.reason ?? 'unknown'}`);
        }
        record = await persistTransition(record, {
          type: 'completed',
          agent: 'qra_emerge_audit',
          proof: { ...ref, verified: verification.verified },
          result: {
            tests: validatedCounts,
            agentEvidence,
            proofSha256: ref.sha256,
          },
        }, {
          completedWork: ['inspect-repository', 'run-node-tests', 'verify-proof'],
          pendingWork: [],
          failedWork: [],
          evidence: [...record.mission.evidence, { agent: 'qra_emerge_audit', executor: 'proof-verifier', result: verification }],
          activeAgents: [],
          artifactReferences: [{ id: 'mission-proof', ...artifactRef, ...artifactVerification }],
        });
        return Object.freeze({ revision: record.revision, mission: record.mission, tests: record.mission.result.tests });
      } catch (error) {
        return block(record, error instanceof Error ? error.message : String(error));
      }
    },

    async getMission({ missionId: id }) {
      return missionState.get({ missionId: id });
    },

    async selectMissionState({ missionId: id, fields }) {
      return missionState.select({ missionId: id, fields });
    },

    async recover() {
      const inspection = await inspectRecovery({ root: workspaceRoot });
      const recovered = [];
      for (const item of inspection.resumable) {
        const record = await missionState.get({ missionId: item.missionId });
        const result = await block(record, 'interrupted execution requires operator retry');
        recovered.push({ missionId: result.mission.id, revision: result.revision });
      }
      return Object.freeze({ recovered: Object.freeze(recovered), blocked: inspection.blocked, corrupt: inspection.corrupt });
    },

  });
}
