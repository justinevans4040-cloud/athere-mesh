import { randomUUID } from 'node:crypto';
import { parseAgentEnvelope, AgentEnvelopeError } from '../../contracts/src/agent-envelope.js';
import { fleetRegistry } from '../../fleet/src/registry.js';

const agentById = new Map(fleetRegistry.agents.map((agent) => [agent.id, agent]));

export class AgentRuntimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AgentRuntimeError';
    this.code = code;
  }
}

function runtimeError(code, message) {
  return new AgentRuntimeError(code, message);
}

function requiredText(value) {
  if (typeof value !== 'string' || value.trim().length === 0) throw runtimeError('INVALID_TEXT', 'request requires non-empty text');
  return value.trim();
}

function advisoryEnvelope(agent, text) {
  const requestId = randomUUID();
  return parseAgentEnvelope({
    mission_id: `advisory-${requestId}`,
    task_id: `chat-${requestId}`,
    agent_id: agent.id,
    capability_id: agent.executorId ?? 'unbound-agent',
    state_version: 0,
    objective: requiredText(text),
    allowed_actions: ['respond'],
    required_inputs: [],
    evidence_requirements: ['non-empty provider response'],
    timeout: 120_000,
    resource_budget: { max_agent_calls: 1, max_tool_calls: 0 },
    expected_output_schema: { type: 'object', required: ['content'] },
    completion_conditions: ['provider returns non-empty content'],
    error_state: null,
    provenance: { requested_by: 'titan-advisory-api', created_at: new Date().toISOString() },
  });
}

function validatedEnvelope(rawEnvelope) {
  try {
    return parseAgentEnvelope(rawEnvelope);
  } catch (error) {
    if (error instanceof AgentEnvelopeError) throw runtimeError('INVALID_AGENT_ENVELOPE', error.message);
    throw error;
  }
}

export function createAgentRuntime({ complete }) {
  if (typeof complete !== 'function') throw new TypeError('agent completion provider is required');
  return Object.freeze({
    async respond({ profile, envelope: rawEnvelope, agentId, text }) {
      const explicitEnvelope = rawEnvelope === undefined ? undefined : validatedEnvelope(rawEnvelope);
      const requestedAgentId = explicitEnvelope?.agent_id ?? agentId;
      const agent = agentById.get(requestedAgentId);
      if (!agent) throw runtimeError('UNKNOWN_AGENT', 'unknown agent');
      if (!agent.enabled) throw runtimeError('AGENT_NOT_OPERATIONAL', 'agent is not operational');
      if (profile === 'public' && agent.distribution !== 'public') throw runtimeError('FORBIDDEN_AGENT', 'agent is owner-only');
      if (profile !== 'owner' && profile !== 'public') throw runtimeError('INVALID_PROFILE', 'unknown runtime profile');

      const envelope = explicitEnvelope ?? advisoryEnvelope(agent, text);
      if (agent.executorId !== envelope.capability_id) {
        throw runtimeError('CAPABILITY_MISMATCH', `agent ${agent.id} is not bound to capability ${envelope.capability_id}`);
      }
      if (!envelope.allowed_actions.includes('respond')) {
        throw runtimeError('ACTION_NOT_ALLOWED', 'agent envelope does not permit respond');
      }

      const response = await complete({
        agent: Object.freeze({ id: agent.id, name: agent.name, role: agent.role }),
        envelope,
        text: envelope.objective,
      });
      const content = response?.content;
      if (typeof content !== 'string' || content.trim().length === 0) throw runtimeError('EMPTY_RESPONSE', 'model returned an empty response');
      return Object.freeze({ agentId: agent.id, content: content.trim(), live: true });
    },
  });
}
