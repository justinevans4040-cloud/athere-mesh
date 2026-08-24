import http from 'node:http';
import { planCommand } from '../../command/src/command-planner.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const MISSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

async function readText(request, maxBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      request.resume();
      const error = new Error('request body too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function json(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

function missionIdFromPath(pathname) {
  const prefix = '/api/missions/';
  if (!pathname.startsWith(prefix)) return undefined;
  const encodedId = pathname.slice(prefix.length);
  if (encodedId.length === 0 || encodedId.includes('/')) throw new Error('invalid mission id');
  let missionId;
  try {
    missionId = decodeURIComponent(encodedId);
  } catch {
    throw new Error('invalid mission id');
  }
  if (!MISSION_ID.test(missionId)) throw new Error('invalid mission id');
  return missionId;
}

function teamView(team) {
  if (!team || !Array.isArray(team.agents)) throw new Error('operational team is unavailable');
  const agents = team.agents.map((agent) => Object.freeze({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    rank: agent.rank,
    enabled: agent.enabled === true,
    executorId: agent.executorId,
    operational: agent.enabled === true && typeof agent.executorId === 'string' && agent.executorId.trim().length > 0,
  }));
  return Object.freeze({
    version: team.version,
    enabledAgents: agents.filter((agent) => agent.operational).length,
    agents: Object.freeze(agents),
  });
}

function operationalDependencies(orchestrator, team, recovery) {
  if (!orchestrator || typeof orchestrator.execute !== 'function' || typeof orchestrator.getMission !== 'function') {
    throw new Error('mission orchestrator is unavailable');
  }
  if (!team || !Array.isArray(team.agents)) throw new Error('operational team is unavailable');
  if (!recovery || !Array.isArray(recovery.recovered) || !Array.isArray(recovery.blocked) || !Array.isArray(recovery.corrupt)) {
    throw new Error('startup recovery summary is unavailable');
  }
}

function errorStatus(error) {
  if (error.statusCode) return error.statusCode;
  if (/owner-only/.test(error.message)) return 403;
  if (/invalid mission id|unknown agent|non-empty text/.test(error.message)) return 400;
  if (/mission snapshot not found/.test(error.message)) return 404;
  if (/is unavailable/.test(error.message)) return 503;
  return 502;
}

export function createTitanApi({ runtime, profile = 'owner', maxRequestBytes = 16_384, orchestrator, team, recovery } = {}) {
  if (!runtime || typeof runtime.respond !== 'function') throw new TypeError('agent runtime is required');
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1) throw new TypeError('maxRequestBytes must be positive');
  let server;
  let baseUrl;

  return Object.freeze({
    get url() { return baseUrl; },
    async listen({ host = '127.0.0.1', port = 3000 } = {}) {
      if (server) throw new Error('Titan API is already listening');
      if (profile === 'owner' && !LOOPBACK.has(host)) throw new Error('owner API must bind to loopback');
      server = http.createServer(async (request, response) => {
        try {
          const url = new URL(request.url, 'http://titan.local');
          if (request.method === 'GET' && url.pathname === '/health') {
            operationalDependencies(orchestrator, team, recovery);
            json(response, 200, { ready: true, enabledAgents: teamView(team).enabledAgents, recovery });
            return;
          }
          if (request.method === 'GET' && url.pathname === '/api/team') {
            operationalDependencies(orchestrator, team, recovery);
            json(response, 200, teamView(team));
            return;
          }
          if (request.method === 'POST' && url.pathname === '/api/commands') {
            operationalDependencies(orchestrator, team, recovery);
            const text = await readText(request, maxRequestBytes);
            json(response, 200, await orchestrator.execute({ profile, text }));
            return;
          }
          if (request.method === 'GET' && url.pathname.startsWith('/api/missions/')) {
            operationalDependencies(orchestrator, team, recovery);
            const missionId = missionIdFromPath(url.pathname);
            json(response, 200, await orchestrator.getMission({ missionId }));
            return;
          }
          if (request.method === 'POST' && url.pathname === '/api/chat') {
            const agentId = url.searchParams.get('agent') || 'agent-vale';
            const text = await readText(request, maxRequestBytes);
            const plan = planCommand({ profile, text });
            if (plan.status === 'ready' || plan.status === 'needs_approval' || plan.status === 'denied') {
              json(response, 409, { error: 'execution request must use /api/commands' });
              return;
            }
            json(response, 200, await runtime.respond({ profile, agentId, text }));
            return;
          }
          json(response, 404, { error: 'not found' });
        } catch (error) {
          json(response, errorStatus(error), { error: error.message });
        }
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
      const address = server.address();
      baseUrl = `http://${host}:${address.port}`;
    },
    async close() {
      if (!server) return;
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      server = undefined;
      baseUrl = undefined;
    },
  });
}
