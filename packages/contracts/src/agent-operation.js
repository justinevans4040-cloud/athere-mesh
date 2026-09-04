import { parseAgentEnvelope } from './agent-envelope.js';
import { assertRoleMayEmitSignal, assertRoleMayPerformAction, roleForAgent } from './execution-roles.js';

const OPERATIONS = Object.freeze({
  'miss-vale-prime': Object.freeze({ capabilityId: 'mission-supervisor', action: 'supervise_mission', signalType: 'running' }),
  nyx: Object.freeze({ capabilityId: 'repository-inspector', action: 'observe_repository', signalType: 'running' }),
  rune: Object.freeze({ capabilityId: 'node-test-runner', action: 'execute_node_tests', signalType: 'running' }),
  qra_emerge_audit: Object.freeze({ capabilityId: 'proof-verifier', action: 'verify_proof', signalType: 'completed' }),
  qra_recovery_driver: Object.freeze({ capabilityId: 'recovery-coordinator', action: 'block_interrupted_mission', signalType: 'blocked' }),
});

function operationFor(agentId) {
  const operation = OPERATIONS[agentId];
  if (!operation) throw new Error(`unknown operational agent: ${agentId}`);
  return operation;
}

export function createAgentOperationEnvelope({
  record,
  operationId,
  agentId,
  objective,
  createdAt,
  taskId,
  requiredInputs = ['authoritative_mission_state'],
  evidenceRequirements = ['operation result', 'mission state version'],
  expectedOutputSchema = { type: 'object', required: ['mission', 'revision'] },
  completionConditions = ['authorized operation reaches its declared durable boundary'],
  timeout = 30_000,
  resourceBudget = { max_state_mutations: 1 },
  requestedBy = 'titan',
} = {}) {
  const operation = operationFor(agentId);
  return parseAgentEnvelope({
    mission_id: record.mission.id,
    task_id: taskId ?? operation.action,
    operation_id: operationId,
    agent_id: agentId,
    capability_id: operation.capabilityId,
    state_version: record.revision,
    objective,
    allowed_actions: [operation.action],
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
  if (parsed.capability_id !== operation.capabilityId) throw new Error(`agent ${parsed.agent_id} is not bound to capability ${parsed.capability_id}`);
  if (parsed.allowed_actions.length !== 1 || parsed.allowed_actions[0] !== operation.action) {
    throw new Error(`agent envelope does not exclusively permit ${operation.action}`);
  }
  assertRoleMayPerformAction(role, operation.action);
  if (signalType !== undefined) {
    try {
      assertRoleMayEmitSignal(role, signalType);
    } catch {
      throw new Error(`agent ${parsed.agent_id} cannot perform ${signalType} transition with ${operation.action}`);
    }
  }
  const permission = (mission.permissions ?? []).find(({ actor }) => actor === parsed.agent_id);
  const legacyRecovery = (mission.permissions ?? []).length === 0
    && parsed.agent_id === 'qra_recovery_driver'
    && operation.action === 'block_interrupted_mission';
  if (!permission?.actions?.includes(operation.action) && !legacyRecovery) {
    throw new Error(`actor ${parsed.agent_id} lacks required permission: ${operation.action}`);
  }
  return Object.freeze({
    envelope: parsed,
    action: operation.action,
    role,
    permission: Object.freeze(structuredClone(permission ?? { actor: parsed.agent_id, actions: [operation.action] })),
  });
}
