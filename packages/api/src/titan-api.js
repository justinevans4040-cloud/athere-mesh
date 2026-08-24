import http from 'node:http';
import { planCommand } from '../../command/src/command-planner.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

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

export function createTitanApi({ runtime, profile = 'owner', maxRequestBytes = 16_384 }) {
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
          if (request.method !== 'POST' || url.pathname !== '/api/chat') {
            json(response, 404, { error: 'not found' });
            return;
          }
          const agentId = url.searchParams.get('agent') || 'agent-vale';
          const text = await readText(request, maxRequestBytes);
          const plan = planCommand({ profile, text });
          if (plan.status === 'ready' || plan.status === 'needs_approval' || plan.status === 'denied') {
            json(response, 409, { error: 'execution request must use /api/commands' });
            return;
          }
          json(response, 200, await runtime.respond({ profile, agentId, text }));
        } catch (error) {
          const statusCode = error.statusCode ?? (/owner-only/.test(error.message) ? 403 : /unknown agent|non-empty text/.test(error.message) ? 400 : 502);
          json(response, statusCode, { error: error.message });
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
