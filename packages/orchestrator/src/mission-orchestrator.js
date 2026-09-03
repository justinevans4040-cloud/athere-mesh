import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { planCommand } from '../../command/src/command-planner.js';
import { authorizeAgentOperation, createAgentOperationEnvelope } from '../../contracts/src/agent-operation.js';
import { parseAgentEnvelope } from '../../contracts/src/agent-envelope.js';
import { parseNodeTestExecutionResult, parseRepositoryInspectionResult } from '../../contracts/src/execution-results.js';
import { nodeExecutionInputBinding } from '../../execution/src/node-test-executor.js';
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

function executionEnvelope({ record, taskId, operation, agentId, capabilityId, action, objective, timeout, budget, outputFields, inputBinding }) {
  return parseAgentEnvelope({
    mission_id: record.mission.id,
    task_id: taskId,
    operation_id: `${record.mission.id}-${operation}`,
    agent_id: agentId,
    capability_id: capabilityId,
    state_version: record.revision,
    objective,
    allowed_actions: [action],
    required_inputs: ['repository_root', inputBinding],
    evidence_requirements: ['executor identity', 'operation result', 'mission state version'],
    timeout,
    resource_budget: budget,
    expected_output_schema: { type: 'object', required: outputFields },
    completion_conditions: ['executor returns the declared result schema without an error state'],
    error_state: null,
    provenance: {
      requested_by: 'miss-vale-prime',
      created_at: record.mission.signals.at(-1).at,
    },
  });
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

  async function persistTransition(record, operationId, signal, update = {}) {
    const envelope = createAgentOperationEnvelope({
      record,
      operationId,
      agentId: signal.agent,
      objective: signal.detail ?? `${signal.type} mission transition`,
      createdAt: record.mission.updatedAt,
      taskId: `${signal.agent}-${signal.type}`,
      evidenceRequirements: signal.type === 'completed'
        ? ['independently verified proof', 'mission state version']
        : ['operation result', 'mission state version'],
    });
    const saved = await missionState.transition({
      operationId,
      missionId: record.mission.id,
      expectedRevision: record.revision,
      signal,
      update,
      envelope,
    });
    if (saved.duplicate !== true) await publish(saved.mission.signals.at(-1));
    return saved;
  }

  async function createAuthoritativeMission({ id, objective }) {
    const record = await missionState.create({
      operationId: `${id}-create`,
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
    const blocked = await persistTransition(record, `${record.mission.id}-block-r${record.revision}`, { type: 'blocked', agent: 'qra_recovery_driver', detail }, {
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
      record = await persistTransition(record, `${record.mission.id}-supervision`, {
        type: 'running', agent: 'miss-vale-prime', detail: 'mission supervision started',
      }, { activeAgents: ['miss-vale-prime'] });

      try {
        const inspection = parseRepositoryInspectionResult(await testExecutor.inspect({
          repositoryRoot,
          envelope: executionEnvelope({
            record,
            taskId: 'inspect-repository',
            operation: 'inspect-execution',
            agentId: 'nyx',
            capabilityId: 'repository-inspector',
            action: 'observe_repository',
            objective: 'Inspect repository metadata and inventory for the active mission',
            timeout: 30_000,
            budget: { max_filesystem_entries: 100_000 },
            outputFields: ['package', 'sourceFilesOnDisk', 'testFilesOnDisk'],
            inputBinding: nodeExecutionInputBinding({ repositoryRoot, operation: 'inspect' }),
          }),
        }));
        const nyxEvidence = Object.freeze({ executor: 'repository-inspector', result: inspection });
        record = await persistTransition(record, `${record.mission.id}-inspection`, {
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
        const result = parseNodeTestExecutionResult(await testExecutor.runTests({
          repositoryRoot,
          envelope: executionEnvelope({
            record,
            taskId: 'run-node-tests',
            operation: 'test-execution',
            agentId: 'rune',
            capabilityId: 'node-test-runner',
            action: 'execute_node_tests',
            objective: 'Execute the complete Node test suite for the active mission',
            timeout: 300_000,
            budget: { max_processes: 1, max_output_bytes: 1_048_576 },
            outputFields: ['command', 'exitCode', 'tests', 'passed', 'failed', 'skipped', 'stdout', 'stderr'],
            inputBinding: nodeExecutionInputBinding({ repositoryRoot, operation: 'test' }),
          }),
        }));
        const validatedCounts = testCounts(result);
        const runeResult = Object.freeze({ command: result.command, exitCode: result.exitCode, ...validatedCounts });
        const runeEvidence = Object.freeze({ executor: 'node-test-runner', result: runeResult });
        record = await persistTransition(record, `${record.mission.id}-tests`, {
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
          operationId: `${record.mission.id}-proof`,
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
        const proofOperationId = `${record.mission.id}-artifact-proof`;
        const proofEnvelope = createAgentOperationEnvelope({
          record,
          operationId: proofOperationId,
          agentId: 'qra_emerge_audit',
          objective: 'Independently verify and provenance-bind the mission proof',
          createdAt: record.mission.updatedAt,
          taskId: 'verify-proof',
          requiredInputs: ['mission_proof_reference', 'mission_proof_bytes'],
          evidenceRequirements: ['proof hash verification', 'artifact provenance verification'],
          expectedOutputSchema: { type: 'object', required: ['verified', 'sha256'] },
          completionConditions: ['proof and artifact provenance both verify against immutable bytes'],
          resourceBudget: { max_proof_reads: 2, max_state_mutations: 0 },
        });
        authorizeAgentOperation({
          envelope: proofEnvelope,
          mission: record.mission,
          expectedRevision: record.revision,
          operationId: proofOperationId,
          signalType: 'completed',
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
          operationId: proofOperationId,
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
        record = await persistTransition(record, `${record.mission.id}-completion`, {
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

    async getMission({ missionId: id, includeHistorical = false }) {
      return missionState.get({ missionId: id, includeHistorical });
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
