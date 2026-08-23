import { fleetRegistry } from '../../fleet/src/registry.js';

const agentById = new Map(fleetRegistry.agents.map((agent) => [agent.id, agent]));

function requiredText(value) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError('request requires non-empty text');
  return value.trim();
}

export function createAgentRuntime({ complete }) {
  if (typeof complete !== 'function') throw new TypeError('agent completion provider is required');
  return Object.freeze({
    async respond({ profile, agentId, text }) {
      const agent = agentById.get(agentId);
      if (!agent) throw new Error('unknown agent');
      if (profile === 'public' && agent.distribution !== 'public') throw new Error('agent is owner-only');
      if (profile !== 'owner' && profile !== 'public') throw new Error('unknown runtime profile');
      const prompt = requiredText(text);
      const response = await complete({
        agent: Object.freeze({ id: agent.id, name: agent.name, role: agent.role }),
        text: prompt,
      });
      const content = response?.content;
      if (typeof content !== 'string' || content.trim().length === 0) throw new Error('model returned an empty response');
      return Object.freeze({ agentId: agent.id, content: content.trim(), live: true });
    },
  });
}
