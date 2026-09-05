import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentRuntimeError } from '../../agent/src/agent-runtime.js';
import { planCommand } from '../../command/src/command-planner.js';
import { isValidBearerCredential, requireBearerCredential } from './bearer-token.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const MISSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DEFAULT_DECK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/command-deck');
const DECK_ASSETS = new Map([
  ['/', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/index.html', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/deck.css', { file: 'deck.css', type: 'text/css; charset=utf-8' }],
  ['/deck.js', { file: 'deck.js', type: 'text/javascript; charset=utf-8' }],
]);

function resolveDeckAsset(pathname, deckRoot) {
  const asset = DECK_ASSETS.get(pathname);
  if (!asset) return undefined;
  const resolvedRoot = path.resolve(deckRoot);
  const resolvedFile = path.resolve(resolvedRoot, asset.file);
  if (resolvedFile !== resolvedRoot && !resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) {
    return undefined;
  }
  return { ...asset, absolutePath: resolvedFile };
}

function publicError(statusCode, message, headers) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  if (headers) error.publicHeaders = headers;
  return error;
}

function sameCredential(received, expected) {
  const left = Buffer.from(received, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function requireTrustedOwnerRequest(request, authToken) {
  const authorization = request.headers.authorization;
  const match = typeof authorization === 'string' ? /^Bearer (.+)$/i.exec(authorization) : undefined;
  if (!match || !isValidBearerCredential(match[1]) || !sameCredential(match[1], authToken)) {
    throw publicError(401, 'authentication required', { 'www-authenticate': 'Bearer realm="titan-owner"' });
  }

  const fetchSite = request.headers['sec-fetch-site'];
  if (typeof fetchSite === 'string' && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw publicError(403, 'cross-site request forbidden');
  }
  const origin = request.headers.origin;
  if (typeof origin === 'string') {
    let expectedOrigin;
    try {
      expectedOrigin = new URL(`http://${request.headers.host}`).origin;
    } catch {
      throw publicError(403, 'cross-site request forbidden');
    }
    if (origin !== expectedOrigin) throw publicError(403, 'cross-site request forbidden');
  }
}

/** Owner token leaves bootstrap only for same-origin deck fetches — not anonymous curl/tunnel scrapers. */
function deckBootstrapMayDiscloseOwnerToken(request) {
  const fetchSite = request.headers['sec-fetch-site'];
  // Chrome same-origin GET often omits Origin; require Sec-Fetch-Site instead.
  if (fetchSite !== 'same-origin') return false;
  let expectedOrigin;
  try {
    expectedOrigin = new URL(`http://${request.headers.host}`).origin;
  } catch {
    return false;
  }
  const origin = request.headers.origin;
  if (typeof origin === 'string' && origin.length > 0 && origin !== expectedOrigin) return false;
  return true;
}

function assertAdvisoryChatAgentAllowed(team, agentId) {
  if (!team || !Array.isArray(team.agents)) throw publicError(503, 'service unavailable');
  const agent = team.agents.find((entry) => entry.id === agentId);
  if (!agent) throw publicError(400, 'unknown agent');
  if (agent.soleMissVale === true || agent.dangerousAuthority === true || agent.distribution !== 'public') {
    throw publicError(403, 'agent not available for advisory chat');
  }
}

function requireTextPlainUtf8(request) {
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || !/^\s*text\/plain\s*;\s*charset\s*=\s*utf-8\s*$/i.test(contentType)) {
    throw publicError(415, 'unsupported media type');
  }
}

async function readText(request, maxBytes) {
  requireTextPlainUtf8(request);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      request.resume();
      throw publicError(413, 'request body too large');
    }
    chunks.push(chunk);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw publicError(400, 'malformed UTF-8 request body');
  }
}

function json(response, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, { ...headers, 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

function missionIdFromPath(pathname) {
  const prefix = '/api/missions/';
  if (!pathname.startsWith(prefix)) return undefined;
  const encodedId = pathname.slice(prefix.length);
  if (encodedId.length === 0 || encodedId.includes('/')) throw publicError(400, 'invalid mission id');
  let missionId;
  try {
    missionId = decodeURIComponent(encodedId);
  } catch {
    throw publicError(400, 'invalid mission id');
  }
  if (!MISSION_ID.test(missionId)) throw publicError(400, 'invalid mission id');
  return missionId;
}

function teamView(team) {
  if (!team || !Array.isArray(team.agents)) throw publicError(503, 'service unavailable');
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
    throw publicError(503, 'service unavailable');
  }
  if (!team || !Array.isArray(team.agents)) throw publicError(503, 'service unavailable');
  if (!recovery || !Array.isArray(recovery.recovered) || !Array.isArray(recovery.blocked) || !Array.isArray(recovery.corrupt)) {
    throw publicError(503, 'service unavailable');
  }
}

function publicRecoverySummary(recovery) {
  return Object.freeze({
    recovered: recovery.recovered.length,
    healed: Array.isArray(recovery.healed) ? recovery.healed.length : 0,
    blocked: recovery.blocked.length,
    corrupt: recovery.corrupt.length,
  });
}

function publicErrorResponse(error) {
  if (typeof error?.publicMessage === 'string' && Number.isSafeInteger(error.statusCode)) {
    return { statusCode: error.statusCode, payload: { error: error.publicMessage }, headers: error.publicHeaders, log: false };
  }
  if (error instanceof AgentRuntimeError) {
    const responses = {
      INVALID_TEXT: { statusCode: 400, error: 'text must be non-empty' },
      UNKNOWN_AGENT: { statusCode: 400, error: 'unknown agent' },
      AGENT_NOT_OPERATIONAL: { statusCode: 409, error: 'agent is not operational' },
      FORBIDDEN_AGENT: { statusCode: 403, error: 'forbidden' },
      INVALID_PROFILE: { statusCode: 403, error: 'forbidden' },
      EMPTY_RESPONSE: { statusCode: 502, error: 'advisory provider returned no content' },
    };
    const mapped = responses[error.code];
    if (mapped) return { statusCode: mapped.statusCode, payload: { error: mapped.error }, log: false };
  }
  if (error?.message === 'mission snapshot not found') return { statusCode: 404, payload: { error: 'mission not found' }, log: false };
  return { statusCode: 500, payload: { error: 'internal server error' }, log: true };
}

export function createTitanApi({
  runtime,
  profile = 'owner',
  authToken,
  maxRequestBytes = 16_384,
  orchestrator,
  team,
  recovery,
  logger = console,
  deckRoot = DEFAULT_DECK_ROOT,
  hostLabel,
} = {}) {
  if (!runtime || typeof runtime.respond !== 'function') throw new TypeError('agent runtime is required');
  let apiAuthToken;
  if (profile === 'owner') {
    apiAuthToken = requireBearerCredential(authToken, 'owner authToken');
  } else if (authToken !== undefined) {
    apiAuthToken = requireBearerCredential(authToken, 'authToken');
  } else {
    apiAuthToken = undefined;
  }
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1) throw new TypeError('maxRequestBytes must be positive');
  if (!logger || typeof logger.error !== 'function') throw new TypeError('logger must provide error');
  if (typeof deckRoot !== 'string' || deckRoot.trim().length === 0) throw new TypeError('deckRoot must be a non-empty string');
  const resolvedDeckRoot = path.resolve(deckRoot);
  const resolvedHostLabel = typeof hostLabel === 'string' && hostLabel.trim().length > 0
    ? hostLabel.trim()
    : (process.env.TITAN_DECK_HOST_LABEL?.trim() || os.hostname() || 'local');
  let server;
  let baseUrl;
  let bindHost;
  let commandInFlight = false;

  function requireAuth(request) {
    if (!apiAuthToken) {
      throw publicError(401, 'authentication required', { 'www-authenticate': 'Bearer realm="titan"' });
    }
    requireTrustedOwnerRequest(request, apiAuthToken);
  }

  async function sendDeckAsset(response, pathname) {
    const asset = resolveDeckAsset(pathname, resolvedDeckRoot);
    if (!asset) return false;
    let body;
    try {
      body = await readFile(asset.absolutePath);
    } catch {
      return false;
    }
    response.writeHead(200, {
      'content-type': asset.type,
      'content-length': body.length,
      'cache-control': 'no-store',
    });
    response.end(body);
    return true;
  }

  return Object.freeze({
    get url() { return baseUrl; },
    async listen({ host = '127.0.0.1', port = 3000 } = {}) {
      if (server) throw new Error('Titan API is already listening');
      if (!LOOPBACK.has(host)) throw new Error('Titan API must bind to loopback');
      bindHost = host;
      server = http.createServer(async (request, response) => {
        try {
          const url = new URL(request.url, 'http://titan.local');
          if (request.method === 'GET' && (url.pathname === '/' || DECK_ASSETS.has(url.pathname))) {
            if (await sendDeckAsset(response, url.pathname)) return;
          }
          if (request.method === 'GET' && url.pathname === '/api/deck/bootstrap') {
            // Same-origin deck fetch may receive ownerToken. Anonymous scrapers get null (prompt/fallback).
            const discloseToken = Boolean(apiAuthToken) && deckBootstrapMayDiscloseOwnerToken(request);
            json(response, 200, {
              product: 'athere-mesh',
              brand: 'There is a there. It is called Athere.',
              profile,
              bind: bindHost,
              hostLabel: resolvedHostLabel,
              ownerToken: discloseToken ? apiAuthToken : null,
              tokenPolicy: 'same-origin-only',
              ui: '/',
            });
            return;
          }
          if (request.method === 'GET' && url.pathname === '/health') {
            requireAuth(request);
            operationalDependencies(orchestrator, team, recovery);
            json(response, 200, { ready: true, enabledAgents: teamView(team).enabledAgents, recovery: publicRecoverySummary(recovery) });
            return;
          }
          if (request.method === 'GET' && url.pathname === '/api/team') {
            requireAuth(request);
            operationalDependencies(orchestrator, team, recovery);
            json(response, 200, teamView(team));
            return;
          }
          if (request.method === 'POST' && url.pathname === '/api/commands') {
            requireAuth(request);
            operationalDependencies(orchestrator, team, recovery);
            const text = await readText(request, maxRequestBytes);
            if (commandInFlight) throw publicError(429, 'command already in progress', { 'retry-after': '1' });
            commandInFlight = true;
            try {
              json(response, 200, await orchestrator.execute({ profile, text }));
            } finally {
              commandInFlight = false;
            }
            return;
          }
          if (request.method === 'GET' && url.pathname.startsWith('/api/missions/')) {
            requireAuth(request);
            operationalDependencies(orchestrator, team, recovery);
            const missionId = missionIdFromPath(url.pathname);
            json(response, 200, await orchestrator.getMission({ missionId }));
            return;
          }
          if (request.method === 'POST' && url.pathname === '/api/chat') {
            // Owner always has a token. Public advisory chat may omit one, but only on loopback.
            if (apiAuthToken) requireTrustedOwnerRequest(request, apiAuthToken);
            const agentId = url.searchParams.get('agent') || 'agent-vale';
            assertAdvisoryChatAgentAllowed(team, agentId);
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
          const responseError = publicErrorResponse(error);
          if (responseError.log) logger.error('Titan API request failed', error);
          json(response, responseError.statusCode, responseError.payload, responseError.headers);
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
      bindHost = undefined;
    },
  });
}
