import { randomUUID } from 'node:crypto';
import { parseAgentEnvelope, AgentEnvelopeError } from '../../contracts/src/agent-envelope.js';
import { fleetRegistry } from '../../fleet/src/registry.js';
import { isCanonicalAgentComposition } from './agent-composition.js';

const agentById = new Map(fleetRegistry.agents.map((agent) => [agent.id, agent]));
const CONTEXT_REQUEST_FIELDS = new Set(['query', 'limit', 'maxEstimatedTokens']);
const SHA256 = /^[a-f0-9]{64}$/;

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
    operation_id: `advisory-operation-${requestId}`,
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

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateContextRequest(contextRequest) {
  if (!plainObject(contextRequest)) {
    throw runtimeError('INVALID_CONTEXT_REQUEST', 'context request must be an object');
  }
  for (const key of Object.keys(contextRequest)) {
    if (!CONTEXT_REQUEST_FIELDS.has(key)) {
      throw runtimeError('INVALID_CONTEXT_REQUEST', `context request field is forbidden: ${key}`);
    }
  }
  if (contextRequest.query !== undefined && !plainObject(contextRequest.query)) {
    throw runtimeError('INVALID_CONTEXT_REQUEST', 'context request query must be an object');
  }
  return contextRequest;
}

function contextQuery(request, envelope) {
  if (request.query === undefined) return Object.freeze({ text: envelope.objective });
  const hasSelector = ['key', 'text', 'goalId'].some((key) => (
    typeof request.query[key] === 'string' && request.query[key].trim().length > 0
  ));
  if (!hasSelector) {
    throw runtimeError('INVALID_CONTEXT_REQUEST', 'context request query requires key, text, or goalId');
  }
  return request.query;
}

function indexCompositions(compositions) {
  if (!Array.isArray(compositions)) throw new TypeError('compositions must be an array');
  const indexed = new Map();
  for (const composition of compositions) {
    if (!isCanonicalAgentComposition(composition)) {
      throw new TypeError('canonical agent composition from createAgentComposition is required');
    }
    const agentId = composition?.agent?.id;
    if (typeof agentId !== 'string' || agentId.trim().length === 0) {
      throw new TypeError('composition must include a canonical agent');
    }
    if (indexed.has(agentId)) throw new Error(`duplicate composition for agent: ${agentId}`);
    const canonical = agentById.get(agentId);
    if (!canonical || canonical !== composition.agent) {
      throw new Error(`composition agent is not canonical: ${agentId}`);
    }
    if (composition.capabilityId !== canonical.executorId) {
      throw new Error(`composition capability mismatch for agent: ${agentId}`);
    }
    if (typeof composition?.modelAdapter?.complete !== 'function') {
      throw new TypeError(`composition model adapter is required for agent: ${agentId}`);
    }
    indexed.set(agentId, composition);
  }
  return indexed;
}

function contextIdentity(bound) {
  return Object.freeze({
    handle: bound.handle,
    integritySha256: bound.integritySha256,
    stateVersion: bound.stateVersion,
    stateHash: bound.stateHash,
    reader: bound.reader,
  });
}

function validateBoundContext(bound, envelope, agent) {
  if (!plainObject(bound)) throw runtimeError('INVALID_PREPARED_CONTEXT', 'prepared context binder returned invalid data');
  if (bound.missionId !== envelope.mission_id) {
    throw runtimeError('CONTEXT_MISSION_MISMATCH', 'prepared context mission does not match operation envelope');
  }
  if (bound.reader !== agent.id) {
    throw runtimeError('CONTEXT_READER_MISMATCH', 'prepared context reader does not match agent identity');
  }
  if (bound.stateVersion !== envelope.state_version) {
    throw runtimeError('CONTEXT_STATE_MISMATCH', 'prepared context state version does not match operation envelope');
  }
  if (typeof bound.stateHash !== 'string' || !SHA256.test(bound.stateHash)) {
    throw runtimeError('INVALID_PREPARED_CONTEXT', 'prepared context state hash is invalid');
  }
  if (typeof bound.handle !== 'string' || !/^ctx_[a-f0-9]{32}$/.test(bound.handle)) {
    throw runtimeError('INVALID_PREPARED_CONTEXT', 'prepared context handle is invalid');
  }
  if (typeof bound.integritySha256 !== 'string' || !SHA256.test(bound.integritySha256)) {
    throw runtimeError('INVALID_PREPARED_CONTEXT', 'prepared context integrity is invalid');
  }
}

function operationDeadline(timeoutMs) {
  const controller = new AbortController();
  const expiresAt = Date.now() + timeoutMs;

  return Object.freeze({
    signal: controller.signal,
    async run(stage, operation) {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        controller.abort();
        throw runtimeError('OPERATION_TIMEOUT', `operation timed out after ${timeoutMs}ms during ${stage}`);
      }
      let timer;
      try {
        return await Promise.race([
          Promise.resolve().then(() => operation({
            signal: controller.signal,
            remainingMs: remaining,
          })),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(runtimeError('OPERATION_TIMEOUT', `operation timed out after ${timeoutMs}ms during ${stage}`));
            }, remaining);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

export function createAgentRuntime({ complete, compositions = [] } = {}) {
  if (complete !== undefined && typeof complete !== 'function') throw new TypeError('agent completion provider must be a function');
  const compositionByAgentId = indexCompositions(compositions);
  if (typeof complete !== 'function' && compositionByAgentId.size === 0) {
    throw new TypeError('agent completion provider or composition is required');
  }

  return Object.freeze({
    async respond({ profile, envelope: rawEnvelope, agentId, text, contextRequest }) {
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
      const advisory = envelope.mission_id.startsWith('advisory-') || envelope.state_version === 0;
      if (advisory) {
        if (!envelope.allowed_actions.includes('respond')) {
          throw runtimeError('ACTION_NOT_ALLOWED', 'advisory agent envelope does not permit respond');
        }
        if (Number(envelope.resource_budget?.max_tool_calls) > 0) {
          throw runtimeError('ADVISORY_TOOLS_FORBIDDEN', 'advisory envelope cannot admit operational tools');
        }
        if (envelope.allowed_actions.some((action) => action !== 'respond')) {
          throw runtimeError('ADVISORY_TOOLS_FORBIDDEN', 'advisory envelope cannot admit operational tools');
        }
        if (contextRequest !== undefined) {
          throw runtimeError('ADVISORY_CONTEXT_FORBIDDEN', 'advisory invocation cannot request operational mission context');
        }
      } else if (contextRequest !== undefined) {
        if (envelope.allowed_actions.length !== 1 || envelope.allowed_actions[0] === 'respond') {
          throw runtimeError('ACTION_NOT_ALLOWED', 'operational context requires one canonical operational action');
        }
      }

      const composition = compositionByAgentId.get(agent.id);
      const provider = composition?.modelAdapter?.complete ?? complete;
      if (typeof provider !== 'function') {
        throw runtimeError('NO_COMPLETION_PROVIDER', `no completion provider configured for agent ${agent.id}`);
      }

      const deadline = operationDeadline(envelope.timeout);
      let preparedContext;
      let identity;
      if (contextRequest !== undefined) {
        const request = validateContextRequest(contextRequest);
        const query = contextQuery(request, envelope);
        if (!composition?.preparedContext
          || typeof composition.preparedContext.bind !== 'function'
          || typeof composition.preparedContext.revalidate !== 'function') {
          throw runtimeError('CONTEXT_BINDER_UNAVAILABLE', `prepared context is not configured for agent ${agent.id}`);
        }
        await deadline.run('before_context', ({ signal }) => composition.hooks?.run('before_context', {
          missionId: envelope.mission_id,
          agentId: agent.id,
          stateVersion: envelope.state_version,
          query,
        }, { signal }));
        preparedContext = await deadline.run('context_binding', ({ signal }) => composition.preparedContext.bind({
          missionId: envelope.mission_id,
          reader: agent.id,
          query,
          ...(request.limit === undefined ? {} : { limit: request.limit }),
          ...(request.maxEstimatedTokens === undefined ? {} : { maxEstimatedTokens: request.maxEstimatedTokens }),
          signal,
        }));
        validateBoundContext(preparedContext, envelope, agent);
        identity = contextIdentity(preparedContext);
        await deadline.run('after_context', ({ signal }) => composition.hooks?.run('after_context', {
          missionId: envelope.mission_id,
          agentId: agent.id,
          stateVersion: envelope.state_version,
          context: identity,
        }, { signal }));
      }

      const skills = composition?.skills?.list();
      await deadline.run('before_agent', ({ signal }) => composition?.hooks?.run('before_agent', {
        missionId: envelope.mission_id,
        agentId: agent.id,
        capabilityId: envelope.capability_id,
        stateVersion: envelope.state_version,
        ...(identity === undefined ? {} : { context: identity }),
      }, { signal }));

      if (preparedContext !== undefined) {
        preparedContext = await deadline.run(
          'context_revalidation',
          ({ signal }) => composition.preparedContext.revalidate(preparedContext, { signal }),
        );
        validateBoundContext(preparedContext, envelope, agent);
        identity = contextIdentity(preparedContext);
      }

      const response = await deadline.run('provider', ({ signal }) => provider({
        agent: Object.freeze({ id: agent.id, name: agent.name, role: agent.role }),
        envelope,
        text: envelope.objective,
        signal,
        ...(preparedContext === undefined ? {} : { preparedContext }),
        ...(skills === undefined ? {} : { skills }),
      }));
      const content = response?.content;
      if (typeof content !== 'string' || content.trim().length === 0) throw runtimeError('EMPTY_RESPONSE', 'model returned an empty response');
      const normalizedContent = content.trim();

      await deadline.run('after_agent', ({ signal }) => composition?.hooks?.run('after_agent', {
        missionId: envelope.mission_id,
        agentId: agent.id,
        capabilityId: envelope.capability_id,
        stateVersion: envelope.state_version,
        ...(identity === undefined ? {} : { context: identity }),
        content: normalizedContent,
      }, { signal }));

      return Object.freeze({
        agentId: agent.id,
        content: normalizedContent,
        live: true,
        ...(identity === undefined ? {} : { context: identity }),
      });
    },
  });
}
