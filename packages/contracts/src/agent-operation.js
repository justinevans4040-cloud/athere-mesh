import { parseAgentEnvelope } from './agent-envelope.js';
import {
  assertRoleMayEmitSignal,
  assertRoleMayPerformAction,
  isRecoveryAction,
  roleForAgent,
} from './execution-roles.js';

const OPERATIONS = Object.freeze({
  'miss-vale-prime': Object.freeze({ capabilityId: 'mission-supervisor', action: 'supervise_mission', signalType: 'running' }),
  'the-britt': Object.freeze({ capabilityId: 'dangerous-authority-coholder', action: 'cohold_dangerous_authority', signalType: 'running' }),
  caretaker: Object.freeze({ capabilityId: 'fleet-health-runner', action: 'fleet_health_check', signalType: 'running' }),
  'agent-vale': Object.freeze({ capabilityId: 'ollama-chat', action: 'advisory_chat', signalType: 'running' }),
  qra_sentinel: Object.freeze({ capabilityId: 'output-governor', action: 'screen_agent_output', signalType: 'running' }),
  nyx: Object.freeze({
    capabilityId: 'repository-inspector',
    action: 'observe_repository',
    signalType: 'running',
    allowedActions: Object.freeze(['observe_repository', 'mutate_workspace_files']),
    capabilityFor: Object.freeze({
      observe_repository: 'repository-inspector',
      mutate_workspace_files: 'workspace-file-worker',
    }),
  }),
  loom: Object.freeze({ capabilityId: 'resource-commander', action: 'resource_clearance', signalType: 'running' }),
  rune: Object.freeze({
    capabilityId: 'node-test-runner',
    action: 'execute_node_tests',
    signalType: 'running',
    allowedActions: Object.freeze(['execute_node_tests', 'execute_titan_build']),
    capabilityFor: Object.freeze({
      execute_node_tests: 'node-test-runner',
      execute_titan_build: 'titan-build-runner',
    }),
  }),
  echo: Object.freeze({ capabilityId: 'resonance-signal-monitor', action: 'analyze_resonance_signals', signalType: 'running' }),
  wake_operator: Object.freeze({ capabilityId: 'configuration-engine', action: 'configure_wake', signalType: 'running' }),
  aether_wlm: Object.freeze({ capabilityId: 'execution-kernel', action: 'execute_wlm_kernel', signalType: 'running' }),
  qra_emerge_orchestration: Object.freeze({ capabilityId: 'system-integration-runner', action: 'run_system_integration', signalType: 'running' }),
  qra_emerge_ai_secops: Object.freeze({ capabilityId: 'prompt-injection-defense', action: 'screen_prompt_injection', signalType: 'running' }),
  qra_emerge_audit: Object.freeze({ capabilityId: 'proof-verifier', action: 'verify_proof', signalType: 'completed' }),
  qra_emerge_context: Object.freeze({ capabilityId: 'context-memory-lock', action: 'lock_context_memory', signalType: 'running' }),
  qra_emerge_ethics_liaison: Object.freeze({ capabilityId: 'compliance-liaison', action: 'liaise_compliance', signalType: 'running' }),
  qra_emerge_mlops_data: Object.freeze({ capabilityId: 'data-pipeline-validator', action: 'validate_data_pipeline', signalType: 'running' }),
  qra_emerge_governance: Object.freeze({ capabilityId: 'policy-gatekeeper', action: 'gate_policy', signalType: 'running' }),
  qra_recovery_driver: Object.freeze({ capabilityId: 'recovery-coordinator', action: 'block_interrupted_mission', signalType: 'blocked' }),
  qra_route_controller: Object.freeze({ capabilityId: 'task-cluster-router', action: 'route_cluster_task', signalType: 'running' }),
  qra_signal_watch: Object.freeze({ capabilityId: 'port-watcher', action: 'watch_ports', signalType: 'running' }),
  sales_hunter: Object.freeze({
    capabilityId: 'outbound-acquisition',
    action: 'hunt_outbound',
    signalType: 'running',
    allowedActions: Object.freeze(['hunt_outbound', 'outreach_send']),
    capabilityFor: Object.freeze({
      hunt_outbound: 'outbound-acquisition',
      outreach_send: 'outbound-acquisition',
    }),
  }),
  cluster_core_loop_captain: Object.freeze({ capabilityId: 'sprint-supervisor', action: 'supervise_sprint', signalType: 'running' }),
  cluster_core_ship_lead: Object.freeze({ capabilityId: 'hotfix-shipper', action: 'ship_hotfix', signalType: 'running' }),
  cluster_core_qc_sentinel: Object.freeze({ capabilityId: 'output-reviewer', action: 'review_outbound_output', signalType: 'running' }),
  cluster_core_metrics: Object.freeze({ capabilityId: 'metrics-logger', action: 'log_metrics', signalType: 'running' }),
  cluster_core_comms: Object.freeze({ capabilityId: 'stakeholder-comms', action: 'communicate_stakeholders', signalType: 'running' }),
  ronan_v01: Object.freeze({ capabilityId: 'forensic-investigator', action: 'investigate_forensics', signalType: 'running' }),
});

function operationFor(agentId) {
  const operation = OPERATIONS[agentId];
  if (!operation) throw new Error(`unknown operational agent: ${agentId}`);
  return operation;
}

function capabilityForAction(operation, action) {
  if (operation.capabilityFor && Object.hasOwn(operation.capabilityFor, action)) {
    return operation.capabilityFor[action];
  }
  return operation.capabilityId;
}

function resolveAction(agentId, action) {
  const operation = operationFor(agentId);
  if (action === undefined) return operation.action;
  if (agentId === 'qra_recovery_driver') {
    if (!isRecoveryAction(action)) throw new Error(`unknown recovery action: ${action}`);
    return action;
  }
  if (Array.isArray(operation.allowedActions)) {
    if (!operation.allowedActions.includes(action)) {
      throw new Error(`agent ${agentId} cannot perform action ${action}`);
    }
    return action;
  }
  if (action !== operation.action) {
    throw new Error(`agent ${agentId} cannot override action ${operation.action}`);
  }
  return operation.action;
}

export function createAgentOperationEnvelope({
  record,
  operationId,
  agentId,
  objective,
  createdAt,
  taskId,
  action,
  requiredInputs = ['authoritative_mission_state'],
  evidenceRequirements = ['operation result', 'mission state version'],
  expectedOutputSchema = { type: 'object', required: ['mission', 'revision'] },
  completionConditions = ['authorized operation reaches its declared durable boundary'],
  timeout = 30_000,
  resourceBudget = { max_state_mutations: 1 },
  requestedBy = 'titan',
} = {}) {
  const operation = operationFor(agentId);
  const resolvedAction = resolveAction(agentId, action);
  return parseAgentEnvelope({
    mission_id: record.mission.id,
    task_id: taskId ?? resolvedAction,
    operation_id: operationId,
    agent_id: agentId,
    capability_id: capabilityForAction(operation, resolvedAction),
    state_version: record.revision,
    objective,
    allowed_actions: [resolvedAction],
    required_inputs: requiredInputs,
    evidence_requirements: evidenceRequirements,
    timeout,
    resource_budget: resourceBudget,
    expected_output_schema: expectedOutputSchema,
    completion_conditions: completionConditions,
    error_state: null,
    provenance: { requested_by: requestedBy, created_at: createdAt },
  });
}

export function authorizeAgentOperation({ envelope, mission, expectedRevision, operationId, signalType }) {
  const parsed = parseAgentEnvelope(envelope);
  const operation = operationFor(parsed.agent_id);
  const role = roleForAgent(parsed.agent_id);
  if (parsed.mission_id !== mission.id) throw new Error('agent envelope mission binding mismatch');
  if (parsed.operation_id !== operationId) throw new Error('agent envelope operation binding mismatch');
  if (parsed.state_version !== expectedRevision) throw new Error('agent envelope state version mismatch');
  if (parsed.allowed_actions.length !== 1) {
    throw new Error('agent envelope must exclusively permit exactly one action');
  }
  const requestedAction = parsed.allowed_actions[0];
  if (parsed.capability_id !== capabilityForAction(operation, requestedAction)) {
    throw new Error(`agent ${parsed.agent_id} is not bound to capability ${parsed.capability_id}`);
  }
  if (parsed.agent_id === 'qra_recovery_driver') {
    if (!isRecoveryAction(requestedAction)) throw new Error(`unknown recovery action: ${requestedAction}`);
  } else if (Array.isArray(operation.allowedActions)) {
    if (!operation.allowedActions.includes(requestedAction)) {
      throw new Error(`agent envelope does not exclusively permit a known ${parsed.agent_id} action`);
    }
  } else if (requestedAction !== operation.action) {
    throw new Error(`agent envelope does not exclusively permit ${operation.action}`);
  }
  assertRoleMayPerformAction(role, requestedAction);
  if (signalType !== undefined) {
    try {
      assertRoleMayEmitSignal(role, signalType, { action: requestedAction });
    } catch {
      throw new Error(`agent ${parsed.agent_id} cannot perform ${signalType} transition with ${requestedAction}`);
    }
  }
  const permission = (mission.permissions ?? []).find(({ actor }) => actor === parsed.agent_id);
  const legacyRecovery = (mission.permissions ?? []).length === 0
    && parsed.agent_id === 'qra_recovery_driver'
    && requestedAction === 'block_interrupted_mission';
  if (!permission?.actions?.includes(requestedAction) && !legacyRecovery) {
    throw new Error(`actor ${parsed.agent_id} lacks required permission: ${requestedAction}`);
  }
  return Object.freeze({
    envelope: parsed,
    action: requestedAction,
    role,
    permission: Object.freeze(structuredClone(permission ?? { actor: parsed.agent_id, actions: [requestedAction] })),
  });
}
