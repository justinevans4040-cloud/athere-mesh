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

export function createAgentRuntime({ complete }) {
  if (typeof complete !== 'function') throw new TypeError('agent completion provider is required');
  return Object.freeze({
    async respond({ profile, agentId, text }) {
      const agent = agentById.get(agentId);
      if (!agent) throw runtimeError('UNKNOWN_AGENT', 'unknown agent');
      if (!agent.enabled) throw runtimeError('AGENT_NOT_OPERATIONAL', 'agent is not operational');
      if (profile === 'public' && agent.distribution !== 'public') throw runtimeError('FORBIDDEN_AGENT', 'agent is owner-only');
      if (profile !== 'owner' && profile !== 'public') throw runtimeError('INVALID_PROFILE', 'unknown runtime profile');
      const prompt = requiredText(text);
      const response = await complete({
        agent: Object.freeze({ id: agent.id, name: agent.name, role: agent.role }),
        text: prompt,
      });
      const content = response?.content;
      if (typeof content !== 'string' || content.trim().length === 0) throw runtimeError('EMPTY_RESPONSE', 'model returned an empty response');
      return Object.freeze({ agentId: agent.id, content: content.trim(), live: true });
    },
  });
}
