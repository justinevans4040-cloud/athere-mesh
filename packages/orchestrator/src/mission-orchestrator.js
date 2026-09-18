import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { createAgentComposition } from '../../agent/src/agent-composition.js';
import { createAgentRuntime } from '../../agent/src/agent-runtime.js';
import { createPreparedContextBinder } from '../../agent/src/prepared-context-binding.js';
import { planCommand } from '../../command/src/command-planner.js';
import { authorizeAgentOperation, createAgentOperationEnvelope } from '../../contracts/src/agent-operation.js';
import { parseAgentEnvelope } from '../../contracts/src/agent-envelope.js';
import { parseNodeTestExecutionResult, parseRepositoryInspectionResult } from '../../contracts/src/execution-results.js';
import { nodeExecutionInputBinding } from '../../execution/src/node-test-executor.js';
import { createRemoteDispatchExecutor } from '../../execution/src/remote-dispatch-executor.js';
import { createWorkspaceFileExecutor } from '../../execution/src/workspace-file-executor.js';
import { createTitanBuildExecutor } from '../../execution/src/titan-build-executor.js';
import { createRoleCapabilityExecutor } from '../../execution/src/role-capability-executor.js';
import { createNyxSchema, assertNyxKillSwitch } from '../../nyx/src/nyx-schema.js';
import { createMissionStateService } from '../../mission/src/mission-state-service.js';
import { createSharedProofFacade } from '../../proof/src/shared-proof-facade.js';
import { evaluateQr18Layers, assertQr18LayersVerified } from '../../proof/src/qr18-layered-verification.js';
import { assertSliceAuditFloor, runAuditLadderLoop } from '../../proof/src/step-ladder-audit-loop.js';
import { healMissionFromCheckpoint, recoverAndHealMissions } from '../../recovery/src/recovery-coordinator.js';
import { createMemoryResonanceBus } from '../../resonance/src/resonance-bus.js';
import {
  buildTieInRecord,
  hasWorkSliceCheckpoint,
  isLiveJobStatus,
  nextConcreteStep,
  nextNamedAgent,
  sliceProgress,
} from '../../mission/src/current-job-pointer.js';

/**
 * Keep-mesh OS lifecycle gates (beyond Vale Prime / NYX+RUNE work / audit).
 */
const NOTEBOOK_LIFECYCLE_PERMISSIONS = Object.freeze([
  { actor: 'caretaker', actions: ['fleet_health_check'] },
  { actor: 'qra_emerge_orchestration', actions: ['run_system_integration'] },
  { actor: 'qra_route_controller', actions: ['route_cluster_task'] },
  { actor: 'loom', actions: ['resource_clearance'] },
  { actor: 'the-britt', actions: ['cohold_dangerous_authority'] },
  { actor: 'echo', actions: ['analyze_resonance_signals'] },
  { actor: 'qra_sentinel', actions: ['screen_agent_output'] },
]);

function withNotebookLifecyclePermissions(permissions) {
  return Object.freeze([...permissions, ...NOTEBOOK_LIFECYCLE_PERMISSIONS]);
}

function buildLifecycleResult({ preStages, workAgents, postStages }) {
  return Object.freeze({
    design: 'keep-mesh-add-agents',
    vale: 'Vale Prime',
    apexCoder: 'nyx',
    stages: Object.freeze([...preStages, ...workAgents, ...postStages]),
  });
}

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

function operationalReasoningEnvelope({ record, objective }) {
  return parseAgentEnvelope({
    mission_id: record.mission.id,
    task_id: 'nyx-context-reasoning',
    operation_id: `${record.mission.id}-nyx-context-invocation`,
    agent_id: 'nyx',
    capability_id: 'repository-inspector',
    state_version: record.revision,
    objective,
    allowed_actions: ['respond'],
    required_inputs: ['prepared_context'],
    evidence_requirements: ['prepared-context identity', 'advisory output digest'],
    timeout: 30_000,
    resource_budget: { max_agent_calls: 1, max_tool_calls: 0, max_state_mutations: 0 },
    expected_output_schema: { type: 'object', required: ['content'] },
    completion_conditions: ['provider returns non-empty advisory content'],
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
  store,
  executor,
  fileExecutor,
  buildExecutor,
  roleExecutor,
  remoteWorkQueue,
  remoteRepositoryRoot,
  operationalModelAdapter,
  proofStore = createSharedProofFacade(),
  clock = () => new Date().toISOString(),
  idFactory = randomUUID,
} = {}) {
  const workspaceRoot = requirePath(root, 'root');
  requirePath(repositoryRoot, 'repositoryRoot');
  if (!bus || typeof bus.publish !== 'function') throw new TypeError('bus must provide publish');
  if (store !== undefined && (typeof store?.loadMission !== 'function' || typeof store?.saveMission !== 'function')) {
    throw new TypeError('store must provide loadMission and saveMission');
  }
  if (remoteWorkQueue !== undefined) {
    if (typeof remoteWorkQueue?.enqueue !== 'function' || typeof remoteWorkQueue?.awaitResult !== 'function') {
      throw new TypeError('remoteWorkQueue must provide enqueue and awaitResult');
    }
  }
  if (proofStore == null
    || typeof proofStore.writeProof !== 'function'
    || typeof proofStore.verifyProof !== 'function'
    || typeof proofStore.writeArtifactProof !== 'function'
    || typeof proofStore.verifyArtifactProof !== 'function'
    || typeof proofStore.readProofBytes !== 'function') {
    throw new TypeError('proofStore must provide writeProof, verifyProof, writeArtifactProof, verifyArtifactProof, and readProofBytes');
  }
  const workspaceFiles = fileExecutor ?? createWorkspaceFileExecutor({ repositoryRoot });
  if (typeof workspaceFiles?.inventory !== 'function' || typeof workspaceFiles?.organizeByType !== 'function') {
    throw new TypeError('fileExecutor must provide inventory and organizeByType');
  }
  const titanBuild = buildExecutor ?? createTitanBuildExecutor();
  if (typeof titanBuild?.build !== 'function') {
    throw new TypeError('buildExecutor must provide build');
  }
  const roles = roleExecutor ?? createRoleCapabilityExecutor({
    repositoryRoot,
    workspaceRoot,
  });
  if (typeof roles?.caretakerFleetHealth !== 'function'
    || typeof roles?.loomClearance !== 'function'
    || typeof roles?.echoAnalyze !== 'function'
    || typeof roles?.sentinelScreen !== 'function'
    || typeof roles?.execute !== 'function') {
    throw new TypeError('roleExecutor must provide caretakerFleetHealth, loomClearance, echoAnalyze, sentinelScreen, and execute');
  }
  const localExecutor = executorForTests(executor);
  // When a work queue is injected, both inspect-repository and run-node-tests
  // are dispatched to the remote worker (lease-claimed). Offline hermetic
  // tests omit the queue and keep the previous in-process executor path.
  // Envelope input bindings must hash the worker's repository root — the
  // worker validates bindings against job.repositoryRoot, not the owner's
  // local checkout path.
  const workerRepositoryRoot = remoteWorkQueue === undefined
    ? repositoryRoot
    : (remoteRepositoryRoot ?? repositoryRoot);
  const testExecutor = remoteWorkQueue === undefined
    ? localExecutor
    : createRemoteDispatchExecutor({
      localExecutor,
      workQueue: remoteWorkQueue,
      workerRepositoryRoot,
    });
  // Default remains the hermetic filesystem store. Inject a shared store
  // (Postgres adapter) only when the operator has configured one.
  const missionState = createMissionStateService({
    root: workspaceRoot,
    clock,
    ...(store === undefined ? {} : { store }),
  });
  const operationalRuntime = operationalModelAdapter === undefined
    ? null
    : createAgentRuntime({
      compositions: [createAgentComposition({
        agentId: 'nyx',
        capabilityId: 'repository-inspector',
        modelAdapter: operationalModelAdapter,
        preparedContext: createPreparedContextBinder({
          service: missionState,
          root: path.join(workspaceRoot, 'prepared-context'),
        }),
      })],
    });

  // Every operational bus fails closed unless an explicitly telemetry-only
  // implementation opts out. Silent publish loss creates a state/stream split.
  const failClosedOnPublish = bus.failClosedOnPublish !== false;

  let signalSequence = 0;
  async function publish(signal) {
    signalSequence += 1;
    const payload = {
      id: `${signal.missionId}-signal-${signalSequence}`,
      missionId: signal.missionId,
      type: signal.type,
      agent: signal.agent,
      at: signal.at,
      ...(signal.detail ? { detail: signal.detail } : {}),
      ...(signal.proof ? { proof: signal.proof } : {}),
    };
    try {
      await bus.publish(payload);
    } catch (error) {
      if (failClosedOnPublish) {
        const reason = error instanceof Error ? error.message : String(error);
        const wrapped = new Error(`resonance publish failed: ${reason}`);
        wrapped.cause = error;
        throw wrapped;
      }
      return false;
    }
    return true;
  }

  async function persistTransition(record, operationId, signal, update = {}, observability = null) {
    const envelope = createAgentOperationEnvelope({
      record,
      operationId,
      agentId: signal.agent,
      objective: signal.detail ?? `${signal.type} mission transition`,
      createdAt: record.mission.updatedAt,
      taskId: `${signal.agent}-${signal.type}`,
      ...(typeof signal.action === 'string' ? { action: signal.action } : {}),
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
      ...(observability === null ? {} : { observability }),
    });
    // Publish duplicate state operations too: bus idempotency makes this safe
    // and lets a caller retry repair a prior commit-then-publish failure.
    await publish(saved.mission.signals.at(-1));
    return saved;
  }

  /**
   * OS pre-work gates after Vale Prime (keep mesh, add agents):
   * Caretaker → QRA org → QRA route (NYX Apex Coder) → LOOM → Britt cohold.
   * Does not write mission.evidence (MEA work evidence stays NYX/RUNE performers).
   */
  async function runNotebookPreLifecycle(record, { domain = 'code' } = {}) {
    const stages = [];
    let current = record;
    const fail = (message) => {
      const error = new Error(message);
      error.lastRecord = current;
      throw error;
    };

    const caretakerResult = await roles.caretakerFleetHealth({
      services: [
        { id: 'repository', path: path.resolve(repositoryRoot) },
        { id: 'workspace', path: path.resolve(workspaceRoot) },
      ],
    });
    if (caretakerResult?.decision === 'DEGRADED' || caretakerResult?.healthy === false) {
      fail(`Caretaker fleet health DEGRADED: ${JSON.stringify(caretakerResult?.services ?? caretakerResult)}`);
    }
    current = await persistTransition(current, `${current.mission.id}-caretaker`, {
      type: 'running',
      agent: 'caretaker',
      action: 'fleet_health_check',
      detail: 'Caretaker fleet orchestration',
      evidence: Object.freeze({ stage: 'caretaker', result: caretakerResult }),
    }, { activeAgents: ['caretaker'] });
    stages.push('caretaker');

    const qraOrg = await roles.execute('system-integration-runner', { agentId: 'qra_emerge_orchestration' });
    current = await persistTransition(current, `${current.mission.id}-qra-org`, {
      type: 'running',
      agent: 'qra_emerge_orchestration',
      action: 'run_system_integration',
      detail: 'QRA operational coordination',
      evidence: Object.freeze({ stage: 'qra_emerge_orchestration', result: qraOrg }),
    }, { activeAgents: ['qra_emerge_orchestration'] });
    stages.push('qra_emerge_orchestration');

    const nyxSchema = createNyxSchema();
    assertNyxKillSwitch(nyxSchema);
    const routeResult = await roles.execute('task-cluster-router', {
      agentId: 'qra_route_controller',
      domain,
      assignedAgentId: 'nyx',
      assignedRole: 'apex_coder',
      nyxSchema,
    });
    current = await persistTransition(current, `${current.mission.id}-qra-route`, {
      type: 'running',
      agent: 'qra_route_controller',
      action: 'route_cluster_task',
      detail: 'QRA route assigns NYX Apex Coder',
      evidence: Object.freeze({
        stage: 'qra_route_controller',
        assignedAgentId: 'nyx',
        assignedRole: 'apex_coder',
        nyxSchema,
        result: routeResult,
      }),
    }, { activeAgents: ['qra_route_controller'] });
    stages.push('qra_route_controller');
    stages.push('nyx');

    const loomResult = await roles.loomClearance();
    if (loomResult?.decision === 'BLOCK') {
      fail(`LOOM resource clearance BLOCK: ${(loomResult.reasons || []).join(',') || 'resource gate'}`);
    }
    current = await persistTransition(current, `${current.mission.id}-loom`, {
      type: 'running',
      agent: 'loom',
      action: 'resource_clearance',
      detail: 'LOOM resource clearance before NYX work',
      evidence: Object.freeze({ stage: 'loom', result: loomResult }),
    }, { activeAgents: ['loom'] });
    stages.push('loom');

    const brittCohold = await roles.execute('dangerous-authority-coholder', { agentId: 'the-britt' });
    current = await persistTransition(current, `${current.mission.id}-britt-cohold`, {
      type: 'running',
      agent: 'the-britt',
      action: 'cohold_dangerous_authority',
      detail: 'Britt durable-execution cohold (does not replace NYX)',
      evidence: Object.freeze({ stage: 'the-britt-cohold', result: brittCohold }),
    }, { activeAgents: ['the-britt'] });
    stages.push('the-britt');

    return { record: current, stages: Object.freeze(stages), assignedAgentId: 'nyx' };
  }

  /**
   * OS post-work gates before auditor:
   * Britt assemble → ECHO → QRA Sentinel. Auditor alone still certifies.
   */
  async function runNotebookPostLifecycle(record, { screenText }) {
    const stages = [];
    let current = record;
    const fail = (message) => {
      const error = new Error(message);
      error.lastRecord = current;
      throw error;
    };

    const assembled = Object.freeze({
      stage: 'result-assembly',
      missionId: current.mission.id,
      revision: current.revision,
      specialistEvidenceAgents: (current.mission.evidence ?? []).map((entry) => entry.agent),
    });
    const brittAssemble = await roles.execute('dangerous-authority-coholder', {
      agentId: 'the-britt',
      assembly: assembled,
    });
    current = await persistTransition(current, `${current.mission.id}-britt-assemble`, {
      type: 'running',
      agent: 'the-britt',
      action: 'cohold_dangerous_authority',
      detail: 'Britt result assembly before validation',
      evidence: Object.freeze({ stage: 'the-britt-assemble', result: brittAssemble, assembled }),
    }, { activeAgents: ['the-britt'] });
    stages.push('the-britt');

    const echoResult = await roles.echoAnalyze();
    if (echoResult?.decision === 'DRIFT') {
      fail(`ECHO resonance DRIFT: ${JSON.stringify(echoResult.driftFlags ?? [])}`);
    }
    current = await persistTransition(current, `${current.mission.id}-echo`, {
      type: 'running',
      agent: 'echo',
      action: 'analyze_resonance_signals',
      detail: 'ECHO post-work resonance validation',
      evidence: Object.freeze({ stage: 'echo', result: echoResult }),
    }, { activeAgents: ['echo'] });
    stages.push('echo');

    const sentinelInput = [
      typeof current.mission?.objective === 'string' ? current.mission.objective : '',
      typeof screenText === 'string' ? screenText : '',
    ].filter((part) => part.trim().length > 0).join('\n');
    if (sentinelInput.trim().length === 0) {
      fail('QRA Sentinel refused empty screen input');
    }
    const sentinelResult = roles.sentinelScreen({
      text: sentinelInput,
      agentId: 'specialist-assembly',
    });
    if (sentinelResult?.safe !== true || sentinelResult?.cleared !== true) {
      fail(`QRA Sentinel blocked delivery: ${sentinelResult?.feedback ?? 'output unsafe'}`);
    }
    current = await persistTransition(current, `${current.mission.id}-sentinel`, {
      type: 'running',
      agent: 'qra_sentinel',
      action: 'screen_agent_output',
      detail: 'QRA Sentinel output-boundary assessment',
      evidence: Object.freeze({ stage: 'qra_sentinel', result: sentinelResult }),
    }, { activeAgents: ['qra_sentinel'] });
    stages.push('qra_sentinel');

    return { record: current, stages: Object.freeze(stages) };
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
      permissions: withNotebookLifecyclePermissions([
        { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
        { actor: 'nyx', actions: ['observe_repository'] },
        { actor: 'rune', actions: ['execute_node_tests'] },
        { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
        { actor: 'qra_recovery_driver', actions: [
          'block_interrupted_mission',
          'create_checkpoint',
          'create_branch',
          'quarantine_branch',
          'rollback_to_checkpoint',
          'retry_from_checkpoint',
        ] },
      ]),
      currentPlan: { id: 'titan-test-plan', version: 1, steps: ['inspect-repository', 'run-node-tests', 'verify-proof'] },
      environmentObservations: [{ source: 'titan', key: 'repository_root', value: repositoryRoot, observedAt: clock() }],
    });
    await publish(record.mission.signals.at(-1));
    return record;
  }

  async function createFileWorkMission({ id, objective, action }) {
    const isOrganize = action.resource === 'organize-by-type';
    const workSubgoal = isOrganize ? 'organize-files' : 'inventory-files';
    const workObjective = isOrganize
      ? `Organize files by type under ${action.target}`
      : `Inventory files under ${action.target}`;
    const nyxAction = isOrganize ? 'mutate_workspace_files' : 'observe_repository';
    const record = await missionState.create({
      operationId: `${id}-create`,
      id,
      objective,
      goals: [{ id: 'perform-owner-work', objective: 'Perform bounded owner file work' }],
      subgoals: [
        { id: workSubgoal, objective: workObjective, goalId: 'perform-owner-work' },
        { id: 'verify-proof', objective: 'Verify proof-bound completion', goalId: 'perform-owner-work' },
      ],
      dependencies: [
        { prerequisite: workSubgoal, dependent: 'verify-proof' },
      ],
      constraints: ['completion requires independently verified proof', 'model output is advisory only'],
      permissions: withNotebookLifecyclePermissions([
        { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
        { actor: 'nyx', actions: [nyxAction] },
        { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
        { actor: 'qra_recovery_driver', actions: [
          'block_interrupted_mission',
          'create_checkpoint',
          'create_branch',
          'quarantine_branch',
          'rollback_to_checkpoint',
          'retry_from_checkpoint',
        ] },
      ]),
      currentPlan: { id: 'owner-file-work-plan', version: 1, steps: [workSubgoal, 'verify-proof'] },
      environmentObservations: [
        { source: 'titan', key: 'file_work_target', value: action.target, observedAt: clock() },
        { source: 'titan', key: 'file_work_resource', value: action.resource, observedAt: clock() },
      ],
    });
    await publish(record.mission.signals.at(-1));
    return record;
  }

  async function certifyWithProof({ record, payload, agentEvidence, completedWork, resultExtras = {} }) {
    const ref = await proofStore.writeProof({
      root: workspaceRoot,
      missionId: record.mission.id,
      operationId: `${record.mission.id}-proof`,
      payload: {
        ...payload,
        completedWork,
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
      nowMs: Date.parse(clock()) || Date.now(),
      requiredBudgetKey: 'max_proof_reads',
    });
    const verification = await proofStore.verifyProof({ root: workspaceRoot, ref });
    if (verification.verified !== true) throw new Error(`proof verification failed: ${verification.reason ?? 'unknown'}`);
    const proofBytes = await proofStore.readProofBytes(workspaceRoot, ref);
    const verifierResult = Object.freeze({
      verifier: 'qra_emerge_audit',
      verified: true,
      proofSha256: ref.sha256,
    });
    const artifactRef = await proofStore.writeArtifactProof({
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
    const artifactVerification = await proofStore.verifyArtifactProof({ root: workspaceRoot, ref: artifactRef, artifact: proofBytes });
    if (artifactVerification.verified !== true) {
      throw new Error(`artifact provenance verification failed: ${artifactVerification.reason ?? 'unknown'}`);
    }
    const completionUpdate = {
      completedWork,
      pendingWork: [],
      failedWork: [],
      activeAgents: [],
      artifactReferences: [{ id: 'mission-proof', ...artifactRef, ...artifactVerification, serviceVerified: true }],
    };
    const qr18 = evaluateQr18Layers({
      mission: Object.freeze({ ...record.mission, ...completionUpdate }),
      proofVerification: verification,
      certifierAgentId: 'qra_emerge_audit',
      transitionHistory: record.mission.transitionHistory,
      proofPayload: { completedWork },
    });
    assertQr18LayersVerified(qr18);
    record = await persistTransition(record, `${record.mission.id}-completion`, {
      type: 'completed',
      agent: 'qra_emerge_audit',
      proof: { ...ref, verified: verification.verified },
      result: {
        agentEvidence,
        proofSha256: ref.sha256,
        auditorVerification: verification,
        qr18,
        ...resultExtras,
      },
    }, completionUpdate);
    return record;
  }

  async function executeFileWork({ text, action, existing }) {
    const isOrganize = action.resource === 'organize-by-type';
    const workSubgoal = isOrganize ? 'organize-files' : 'inventory-files';
    const nyxAction = isOrganize ? 'mutate_workspace_files' : 'observe_repository';
    const capabilityId = isOrganize ? 'workspace-file-worker' : 'repository-inspector';
    let record = existing ?? await createFileWorkMission({ id: missionId(idFactory), objective: text, action });
    await bindCurrentJob(record);
    record = (await missionState.admitWork({ missionId: record.mission.id })).record;
    const progress = sliceProgress(record.mission);
    if (!progress.supervised) {
      record = await persistTransition(record, `${record.mission.id}-supervision`, {
        type: 'running', agent: 'miss-vale-prime', detail: 'Vale Prime mission supervision started',
      }, { activeAgents: ['miss-vale-prime'] });
    }

    try {
      const pre = await runNotebookPreLifecycle(record, { domain: 'files' });
      record = pre.record;

      const workStarted = Date.now();
      const fileResult = isOrganize
        ? await workspaceFiles.organizeByType({ target: action.target, dryRun: false })
        : await workspaceFiles.inventory({ target: action.target });
      const workLatencyMs = Date.now() - workStarted;
      const nyxEvidence = Object.freeze({
        executor: 'workspace-file-worker',
        capabilityId,
        action: nyxAction,
        result: fileResult,
      });
      record = await persistTransition(record, `${record.mission.id}-file-work`, {
        type: 'running',
        agent: 'nyx',
        action: nyxAction,
        detail: isOrganize ? 'file organize completed' : 'file inventory completed',
        evidence: nyxEvidence,
      }, {
        evidence: [{ agent: 'nyx', ...nyxEvidence }],
        activeAgents: ['nyx'],
      }, {
        toolCalls: [{ tool: 'workspace-file-worker', agentId: 'nyx', ok: true }],
        latencyMs: workLatencyMs,
        models: [],
        tokenUsage: 0,
        costUsd: 0,
      });
      record = await durableCheckpoint(record, 'after-file-work');

      const agentEvidence = Object.freeze([
        Object.freeze({ agent: 'nyx', ...nyxEvidence }),
      ]);
      const post = await runNotebookPostLifecycle(record, {
        screenText: JSON.stringify({ fileWork: fileResult, agentEvidence }),
      });
      record = post.record;
      const lifecycle = buildLifecycleResult({
        preStages: pre.stages,
        workAgents: ['nyx'],
        postStages: post.stages,
      });
      record = await certifyWithProof({
        record,
        payload: {
          fileWork: fileResult,
          agentEvidence,
          lifecycle,
        },
        agentEvidence,
        completedWork: [workSubgoal, 'verify-proof'],
        resultExtras: { fileWork: fileResult, lifecycle },
      });
      return Object.freeze({
        revision: record.revision,
        mission: record.mission,
        fileWork: fileResult,
      });
    } catch (error) {
      return stopWithTieIn(recordFromLifecycleError(record, error), error instanceof Error ? error.message : String(error));
    }
  }

  async function createBuildMission({ id, objective }) {
    const record = await missionState.create({
      operationId: `${id}-create`,
      id,
      objective,
      goals: [{ id: 'build-titan', objective: 'Build / syntax-verify the Titan runtime tree' }],
      subgoals: [
        { id: 'inspect-repository', objective: 'Inspect the repository state', goalId: 'build-titan' },
        { id: 'run-titan-build', objective: 'Execute the Titan build gate', goalId: 'build-titan' },
        { id: 'verify-proof', objective: 'Verify proof-bound completion', goalId: 'build-titan' },
      ],
      dependencies: [
        { prerequisite: 'inspect-repository', dependent: 'run-titan-build' },
        { prerequisite: 'run-titan-build', dependent: 'verify-proof' },
      ],
      constraints: ['completion requires independently verified proof', 'model output is advisory only'],
      permissions: withNotebookLifecyclePermissions([
        { actor: 'miss-vale-prime', actions: ['supervise_mission'] },
        { actor: 'nyx', actions: ['observe_repository'] },
        { actor: 'rune', actions: ['execute_titan_build'] },
        { actor: 'qra_emerge_audit', actions: ['verify_proof'] },
        { actor: 'qra_recovery_driver', actions: [
          'block_interrupted_mission',
          'create_checkpoint',
          'create_branch',
          'quarantine_branch',
          'rollback_to_checkpoint',
          'retry_from_checkpoint',
        ] },
      ]),
      currentPlan: { id: 'titan-build-plan', version: 1, steps: ['inspect-repository', 'run-titan-build', 'verify-proof'] },
      environmentObservations: [{ source: 'titan', key: 'repository_root', value: repositoryRoot, observedAt: clock() }],
    });
    await publish(record.mission.signals.at(-1));
    return record;
  }

  async function executeBuild({ text, existing }) {
    let record = existing ?? await createBuildMission({ id: missionId(idFactory), objective: text });
    await bindCurrentJob(record);
    record = (await missionState.admitWork({ missionId: record.mission.id })).record;
    const progress = sliceProgress(record.mission);
    if (!progress.supervised) {
      record = await persistTransition(record, `${record.mission.id}-supervision`, {
        type: 'running', agent: 'miss-vale-prime', detail: 'Vale Prime mission supervision started',
      }, { activeAgents: ['miss-vale-prime'] });
    }

    try {
      const pre = await runNotebookPreLifecycle(record, { domain: 'build' });
      record = pre.record;

      const inspectStarted = Date.now();
      const inspection = parseRepositoryInspectionResult(await testExecutor.inspect({
        repositoryRoot: workerRepositoryRoot,
        envelope: executionEnvelope({
          record,
          taskId: 'inspect-repository',
          operation: 'inspect-execution',
          agentId: 'nyx',
          capabilityId: 'repository-inspector',
          action: 'observe_repository',
          objective: 'Inspect repository metadata before Titan build',
          timeout: 30_000,
          budget: { max_filesystem_entries: 100_000 },
          outputFields: ['package', 'sourceFilesOnDisk', 'testFilesOnDisk'],
          inputBinding: nodeExecutionInputBinding({ repositoryRoot: workerRepositoryRoot, operation: 'inspect' }),
        }),
      }));
      const inspectLatencyMs = Date.now() - inspectStarted;
      const nyxEvidence = Object.freeze({ executor: 'repository-inspector', result: inspection });
      record = await persistTransition(record, `${record.mission.id}-inspection`, {
        type: 'running',
        agent: 'nyx',
        detail: 'repository inspection completed',
        evidence: nyxEvidence,
      }, {
        evidence: [{ agent: 'nyx', ...nyxEvidence }],
        activeAgents: ['nyx'],
      }, {
        toolCalls: [{ tool: 'repository-inspector', agentId: 'nyx', ok: true }],
        latencyMs: inspectLatencyMs,
        models: [],
        tokenUsage: 0,
        costUsd: 0,
      });
      record = await durableCheckpoint(record, 'after-inspect');

      const buildStarted = Date.now();
      const buildResult = await titanBuild.build({ repositoryRoot });
      const buildLatencyMs = Date.now() - buildStarted;
      const runeEvidence = Object.freeze({
        executor: 'titan-build-runner',
        action: 'execute_titan_build',
        result: buildResult,
      });
      record = await persistTransition(record, `${record.mission.id}-build`, {
        type: 'running',
        agent: 'rune',
        action: 'execute_titan_build',
        detail: 'titan build gate completed',
        evidence: runeEvidence,
      }, {
        evidence: [...record.mission.evidence, { agent: 'rune', ...runeEvidence }],
        activeAgents: ['rune'],
      }, {
        toolCalls: [{ tool: 'titan-build-runner', agentId: 'rune', ok: buildResult.exitCode === 0 }],
        latencyMs: buildLatencyMs,
        models: [],
        tokenUsage: 0,
        costUsd: 0,
      });
      if (buildResult.exitCode !== 0) {
        throw new Error(`titan build failed: ${buildResult.failedCount} file(s); ${buildResult.stderr.slice(0, 400)}`);
      }
      record = await durableCheckpoint(record, 'after-build');

      const agentEvidence = Object.freeze([
        Object.freeze({ agent: 'nyx', ...nyxEvidence }),
        Object.freeze({ agent: 'rune', ...runeEvidence }),
      ]);
      const post = await runNotebookPostLifecycle(record, {
        screenText: JSON.stringify({ build: buildResult, inspection, agentEvidence }),
      });
      record = post.record;
      const lifecycle = buildLifecycleResult({
        preStages: pre.stages,
        workAgents: ['nyx', 'rune'],
        postStages: post.stages,
      });
      record = await certifyWithProof({
        record,
        payload: {
          build: buildResult,
          inspection,
          agentEvidence,
          lifecycle,
        },
        agentEvidence,
        completedWork: ['inspect-repository', 'run-titan-build', 'verify-proof'],
        resultExtras: { build: buildResult, lifecycle },
      });
      return Object.freeze({
        revision: record.revision,
        mission: record.mission,
        build: buildResult,
      });
    } catch (error) {
      return stopWithTieIn(recordFromLifecycleError(record, error), error instanceof Error ? error.message : String(error));
    }
  }

  async function block(record, detail) {
    const blocked = await persistTransition(record, `${record.mission.id}-block-r${record.revision}`, { type: 'blocked', agent: 'qra_recovery_driver', detail }, {
      activeAgents: [],
      failedWork: record.mission.pendingWork ?? [],
      pendingWork: [],
    });
    return { revision: blocked.revision, mission: blocked.mission };
  }

  async function durableCheckpoint(record, label, extras = {}) {
    const ladder = runAuditLadderLoop({
      mission: record.mission,
      certifierAgentId: 'qra_emerge_audit',
      transitionHistory: record.mission.transitionHistory,
    });
    assertSliceAuditFloor({ ladder, slice: label });
    const operationId = `${record.mission.id}-ckpt-${label}`;
    const tieIn = buildTieInRecord({
      jobId: record.mission.id,
      revision: record.revision,
      statusAfterStop: record.mission.status,
      mission: record.mission,
      actor: 'qra_recovery_driver',
      operationId,
      expectedRevision: record.revision,
      nextStep: extras.nextStep ?? nextConcreteStep(record.mission),
      nextAgent: extras.nextAgent ?? nextNamedAgent(record.mission),
      auditLadder: Object.freeze({
        loop: ladder.loop,
        nextRung: ladder.nextRung?.id ?? null,
        walked: ladder.walked,
        skippedRungs: ladder.skippedRungs,
      }),
      reason: extras.reason ?? 'slice_end',
    });
    return missionState.createCheckpoint({
      operationId,
      missionId: record.mission.id,
      expectedRevision: record.revision,
      label,
      envelope: createAgentOperationEnvelope({
        record,
        operationId,
        agentId: 'qra_recovery_driver',
        action: 'create_checkpoint',
        objective: `durable checkpoint: ${label}`,
        createdAt: record.mission.updatedAt,
        taskId: `checkpoint-${label}`,
      }),
      tieIn,
    });
  }

  async function stopWithTieIn(record, detail) {
    const hadWorkCheckpoint = hasWorkSliceCheckpoint(record.mission);
    let current = record;
    try {
      const operationId = `${record.mission.id}-stop-r${record.revision}`;
      current = await missionState.writeTieIn({
        missionId: record.mission.id,
        expectedRevision: record.revision,
        operationId,
        reason: 'crash',
        actor: 'qra_recovery_driver',
        envelope: createAgentOperationEnvelope({
          record,
          operationId: `${operationId}-checkpoint`,
          agentId: 'qra_recovery_driver',
          action: 'create_checkpoint',
          objective: `tie-in before stop: ${detail}`,
          createdAt: record.mission.updatedAt,
          taskId: 'tie-in-crash',
        }),
      });
    } catch (error) {
      if (!/revision conflict/i.test(error?.message ?? '')) throw error;
      current = await missionState.get({ missionId: record.mission.id, includeHistorical: true });
    }
    if (hadWorkCheckpoint || hasWorkSliceCheckpoint(current.mission)) {
      return blockThenHeal(current, detail);
    }
    const blocked = await block(current, detail);
    const decision = await missionState.decideNext({
      missionId: blocked.mission.id,
      actor: 'orchestrator',
    });
    return Object.freeze({
      revision: blocked.revision,
      mission: blocked.mission,
      status: 'blocked',
      reason: detail,
      executive: decision,
    });
  }

  async function bindCurrentJob(record) {
    const existing = await missionState.loadCurrentJobPointer();
    if (existing?.pointer?.jobId === record.mission.id) return existing;
    try {
      return await missionState.setCurrentJobPointer({
        jobId: record.mission.id,
        missionRevision: record.revision,
        expectedRevision: existing?.revision ?? 0,
        actor: 'titan',
        operationId: `${record.mission.id}-current-job`,
      });
    } catch (error) {
      if (!/revision conflict/i.test(error?.message ?? '')) throw error;
      return missionState.loadCurrentJobPointer();
    }
  }

  async function loadLiveJob({ missionId } = {}) {
    let id = missionId;
    if (!id) {
      const pointer = await missionState.loadCurrentJobPointer();
      id = pointer?.pointer?.jobId;
    }
    if (!id) return undefined;
    try {
      const record = await missionState.get({ missionId: id, includeHistorical: true });
      if (!isLiveJobStatus(record.mission.status)) return undefined;
      return record;
    } catch (error) {
      if (/not found/i.test(error.message)) return undefined;
      throw error;
    }
  }

  async function healLiveIfBlocked(record) {
    if (record.mission.status !== 'blocked') return record;
    await healMissionFromCheckpoint({
      root: workspaceRoot,
      missionId: record.mission.id,
      clock,
      ...(store === undefined ? {} : { missionStore: store }),
    });
    return missionState.get({ missionId: record.mission.id, includeHistorical: true });
  }

  function recordFromLifecycleError(record, error) {
    if (error && typeof error === 'object' && error.lastRecord && typeof error.lastRecord.revision === 'number') {
      return error.lastRecord;
    }
    return record;
  }

  async function blockThenHeal(record, detail) {
    const blocked = await block(record, detail);
    const decision = await missionState.decideNext({
      missionId: record.mission.id,
      actor: 'orchestrator',
    });
    const strategyAction = decision.strategyChange?.action
      ?? decision.strategyChange?.then?.action
      ?? null;
    const shouldRetry = (decision.nextAction === 'change_strategy' || decision.nextAction === 'retry')
      && (strategyAction === 'retry_from_checkpoint'
        || strategyAction === 'rollback_to_checkpoint'
        || strategyAction === 'create_branch'
        || strategyAction === 'quarantine_branch');

    if (!shouldRetry) {
      return Object.freeze({
        revision: blocked.revision,
        mission: blocked.mission,
        status: 'blocked',
        reason: detail,
        executive: decision,
      });
    }

    let healRecord = blocked;
    const verified = (healRecord.mission.checkpoints ?? []).filter((entry) => entry?.verified === true);
    const latestCheckpoint = verified.at(-1);
    const onMain = !healRecord.mission.activeBranchId || healRecord.mission.activeBranchId === 'main';
    // Item 12: open an alternate strategy branch from the last known-good checkpoint
    // before auto-heal when still on main (so quarantine+retry has a failed path to isolate).
    if (latestCheckpoint && onMain) {
      try {
        const branchOp = `${record.mission.id}-alt-branch-${healRecord.revision}`;
        healRecord = await missionState.createBranch({
          operationId: branchOp,
          missionId: record.mission.id,
          expectedRevision: healRecord.revision,
          checkpointId: latestCheckpoint.id,
          strategy: 'orchestrator-auto-heal-alternate',
          envelope: createAgentOperationEnvelope({
            record: healRecord,
            operationId: branchOp,
            agentId: 'qra_recovery_driver',
            action: 'create_branch',
            objective: 'open alternate strategy branch before checkpoint heal',
            createdAt: clock(),
          }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // I12B3: only degrade on known soft failures; never silent-swallow unknown errors.
        if (!/branches exceed cap|lacks required permission|duplicate branch id/i.test(message)) {
          return Object.freeze({
            revision: healRecord.revision,
            mission: healRecord.mission,
            status: 'blocked',
            reason: `alternate branch failed before heal: ${message}`,
            executive: decision,
          });
        }
      }
    }

    const heal = await healMissionFromCheckpoint({
      root: workspaceRoot,
      missionId: record.mission.id,
      clock,
      ...(store === undefined ? {} : { missionStore: store }),
    });
    if (heal.status !== 'healed') {
      const current = await missionState.get({ missionId: record.mission.id });
      return Object.freeze({
        revision: current.revision,
        mission: current.mission,
        status: 'blocked',
        reason: detail,
        executive: decision,
      });
    }
    const healed = await missionState.get({ missionId: record.mission.id });
    return Object.freeze({
      revision: healed.revision,
      mission: healed.mission,
      healed: true,
      status: 'running',
      reason: `auto-healed to last checkpoint after: ${detail}`,
      executive: decision,
    });
  }

  async function executeTestPipeline({ text, existing }) {
    let record = existing ?? await createAuthoritativeMission({ id: missionId(idFactory), objective: text });
    await bindCurrentJob(record);
    const admitted = await missionState.admitWork({ missionId: record.mission.id });
    record = admitted.record;
    const started = sliceProgress(record.mission);
    if (!started.supervised) {
      record = await persistTransition(record, `${record.mission.id}-supervision`, {
        type: 'running', agent: 'miss-vale-prime', detail: 'Vale Prime mission supervision started',
      }, { activeAgents: ['miss-vale-prime'] });
    }

    try {
      let pre = { record, stages: Object.freeze(['caretaker', 'qra_emerge_orchestration', 'qra_route_controller', 'loom', 'the-britt']) };
      if (!sliceProgress(record.mission).preLifecycle) {
        pre = await runNotebookPreLifecycle(record, { domain: 'code' });
        record = pre.record;
      }

      const reasoningOperationId = `${record.mission.id}-nyx-context-reasoning`;
      const reasoningRecorded = (record.mission.transitionHistory ?? [])
        .some((entry) => entry.operationId === reasoningOperationId);
      if (operationalRuntime !== null && !reasoningRecorded) {
        const reasoning = await operationalRuntime.respond({
          profile: 'owner',
          envelope: operationalReasoningEnvelope({
            record,
            objective: `Review current mission context before deterministic execution: ${record.mission.objective}`,
          }),
          contextRequest: {
            query: { text: record.mission.objective },
            maxEstimatedTokens: 4096,
          },
        });
        const advisoryContent = reasoning.content;
        const evidence = Object.freeze({
          stage: 'nyx-context-reasoning',
          advisory: true,
          reasoningAgent: 'nyx',
          context: reasoning.context,
          output: Object.freeze({
            sha256: createHash('sha256').update(advisoryContent, 'utf8').digest('hex'),
            utf8Bytes: Buffer.byteLength(advisoryContent, 'utf8'),
          }),
        });
        record = await persistTransition(record, reasoningOperationId, {
          type: 'running',
          agent: 'miss-vale-prime',
          action: 'supervise_mission',
          detail: 'Vale Prime recorded bounded NYX Prepared Context reasoning',
          evidence,
        }, { activeAgents: ['miss-vale-prime'] });
      }

      let nyxEvidence = (record.mission.evidence ?? []).find((entry) => entry.agent === 'nyx');
      let inspection = nyxEvidence?.result;
      if (!sliceProgress(record.mission).inspected) {
        const inspectStarted = Date.now();
        inspection = parseRepositoryInspectionResult(await testExecutor.inspect({
          repositoryRoot: workerRepositoryRoot,
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
            inputBinding: nodeExecutionInputBinding({ repositoryRoot: workerRepositoryRoot, operation: 'inspect' }),
          }),
        }));
        const inspectLatencyMs = Date.now() - inspectStarted;
        nyxEvidence = Object.freeze({ executor: 'repository-inspector', result: inspection });
        record = await persistTransition(record, `${record.mission.id}-inspection`, {
          type: 'running',
          agent: 'nyx',
          detail: 'repository inspection completed',
          evidence: nyxEvidence,
        }, {
          evidence: [{ agent: 'nyx', ...nyxEvidence }],
          activeAgents: ['nyx'],
        }, {
          toolCalls: [{ tool: 'repository-inspector', agentId: 'nyx', ok: true }],
          latencyMs: inspectLatencyMs,
          models: [],
          tokenUsage: 0,
          costUsd: 0,
        });
        record = await durableCheckpoint(record, 'after-inspect');
      }

      let runeEvidence = (record.mission.evidence ?? []).find((entry) => entry.agent === 'rune');
      let result = runeEvidence?.result;
      if (!sliceProgress(record.mission).tested) {
        const testStarted = Date.now();
        result = parseNodeTestExecutionResult(await testExecutor.runTests({
          repositoryRoot: workerRepositoryRoot,
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
            inputBinding: nodeExecutionInputBinding({ repositoryRoot: workerRepositoryRoot, operation: 'test' }),
          }),
        }));
        const testLatencyMs = Date.now() - testStarted;
        const runeResult = Object.freeze({ command: result.command, exitCode: result.exitCode, ...testCounts(result) });
        runeEvidence = Object.freeze({ executor: 'node-test-runner', result: runeResult });
        record = await persistTransition(record, `${record.mission.id}-tests`, {
          type: 'running',
          agent: 'rune',
          detail: 'node test execution completed',
          evidence: runeEvidence,
        }, {
          evidence: [...record.mission.evidence, { agent: 'rune', ...runeEvidence }],
          activeAgents: ['rune'],
        }, {
          toolCalls: [{ tool: 'node-test-runner', agentId: 'rune', ok: result.exitCode === 0 && result.failed === 0 }],
          latencyMs: testLatencyMs,
          models: [],
          tokenUsage: 0,
          costUsd: 0,
        });
        if (result.exitCode !== 0 || result.failed !== 0) throw new Error(failureMessage(result));
        record = await durableCheckpoint(record, 'after-tests');
      }

      const validatedCounts = testCounts(result);
      const nyxPayload = nyxEvidence?.executor
        ? nyxEvidence
        : Object.freeze({ executor: 'repository-inspector', result: inspection });
      const runePayload = runeEvidence?.executor
        ? runeEvidence
        : Object.freeze({ executor: 'node-test-runner', result });
      const agentEvidence = Object.freeze([
        Object.freeze({ agent: 'nyx', ...nyxPayload }),
        Object.freeze({ agent: 'rune', ...runePayload }),
      ]);
      let post = { record, stages: Object.freeze(['the-britt', 'echo', 'qra_sentinel']) };
      if (!sliceProgress(record.mission).postLifecycle) {
        post = await runNotebookPostLifecycle(record, {
          screenText: JSON.stringify({
            command: result.command,
            exitCode: result.exitCode,
            tests: validatedCounts,
            agentEvidence,
          }),
        });
        record = post.record;
      }
      const lifecycle = buildLifecycleResult({
        preStages: pre.stages,
        workAgents: ['nyx', 'rune'],
        postStages: post.stages,
      });
      if (record.mission.status !== 'completed') {
        record = await certifyWithProof({
          record,
          payload: {
            command: result.command,
            exitCode: result.exitCode,
            tests: validatedCounts,
            stdout: result.stdout,
            stderr: result.stderr,
            inspection,
            agentEvidence,
            lifecycle,
          },
          agentEvidence,
          completedWork: ['inspect-repository', 'run-node-tests', 'verify-proof'],
          resultExtras: { tests: validatedCounts, lifecycle },
        });
      }
      return Object.freeze({ revision: record.revision, mission: record.mission, tests: record.mission.result.tests });
    } catch (error) {
      return stopWithTieIn(recordFromLifecycleError(record, error), error instanceof Error ? error.message : String(error));
    }
  }

  return Object.freeze({
    async execute({ profile, text, missionId: requestedMissionId } = {}) {
      const plan = planCommand({ profile, text });
      let live = await loadLiveJob({ missionId: requestedMissionId });
      if (live) {
        const admitted = await missionState.admitWork({ missionId: live.mission.id });
        live = await healLiveIfBlocked(admitted.record);
        if (live.mission.status === 'blocked') {
          const decision = await missionState.decideNext({
            missionId: live.mission.id,
            actor: 'orchestrator',
          });
          return Object.freeze({
            revision: live.revision,
            mission: live.mission,
            status: 'blocked',
            reason: live.mission.signals.at(-1)?.detail ?? 'blocked',
            executive: decision,
          });
        }
        const planId = live.mission.currentPlan?.id;
        if (planId === 'titan-build-plan') return executeBuild({ text, existing: live });
        if (planId === 'titan-test-plan') return executeTestPipeline({ text, existing: live });
        const steps = live.mission.currentPlan?.steps ?? [];
        const fileAction = steps.includes('organize-files')
          ? { kind: 'local_write', resource: 'organize-by-type', target: 'workspace' }
          : { kind: 'read', resource: 'inventory', target: 'workspace' };
        return executeFileWork({ text, action: fileAction, existing: live });
      }
      if (plan.status !== 'ready') return plan;
      const isFileInventory = plan.action.kind === 'read' && plan.action.resource === 'inventory';
      const isFileOrganize = plan.action.kind === 'local_write' && plan.action.resource === 'organize-by-type';
      if (isFileInventory || isFileOrganize) {
        return executeFileWork({ text, action: plan.action });
      }
      if (plan.action.kind === 'build' && plan.action.target === 'titan') {
        return executeBuild({ text });
      }
      if (plan.action.kind !== 'test') {
        return Object.freeze({ status: 'blocked', reason: `no operational executor for ${plan.action.kind}` });
      }
      return executeTestPipeline({ text });
    },

    async getMission({ missionId: id, includeHistorical = false }) {
      return missionState.get({ missionId: id, includeHistorical });
    },

    async selectMissionState({ missionId: id, fields }) {
      return missionState.select({ missionId: id, fields });
    },

    async getCurrentJob() {
      let pointer;
      try {
        pointer = await missionState.loadCurrentJobPointer();
      } catch (error) {
        if (/pointer store is not wired/i.test(error.message)) {
          return Object.freeze({ pointer: null });
        }
        throw error;
      }
      if (!pointer?.pointer?.jobId) return Object.freeze({ pointer: null });
      try {
        const lookback = await missionState.lookback({ missionId: pointer.pointer.jobId });
        return Object.freeze({ pointer, lookback, missionId: pointer.pointer.jobId, stateVersion: lookback.stateVersion });
      } catch {
        return Object.freeze({ pointer, missionId: pointer.pointer.jobId, missing: true });
      }
    },

    async recover() {
      return recoverAndHealMissions({
        root: workspaceRoot,
        clock,
        ...(store === undefined ? {} : { missionStore: store }),
      });
    },

  });
}
