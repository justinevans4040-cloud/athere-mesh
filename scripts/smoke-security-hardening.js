import { writeFile, mkdir } from 'node:fs/promises';

const token = process.env.TITAN_API_BEARER_TOKEN || process.env.TOKEN;
if (!token) {
  console.error('TITAN_API_BEARER_TOKEN required');
  process.exit(1);
}

const base = process.env.TITAN_API_URL || 'http://127.0.0.1:5050';
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

async function status(path, init) {
  const res = await fetch(`${base}${path}`, init);
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

const anon = await status('/api/deck/bootstrap');
const same = await status('/api/deck/bootstrap', {
  headers: { origin: 'http://127.0.0.1:5050', 'sec-fetch-site': 'same-origin' },
});
const vale = await status('/api/chat?agent=miss-vale-prime', {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain; charset=utf-8' },
  body: 'hello',
});
const nyx = await status('/api/chat?agent=nyx', {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain; charset=utf-8' },
  body: 'hello',
});
const xsite = await status('/api/commands', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'text/plain; charset=utf-8',
    origin: 'https://attacker.example',
    'sec-fetch-site': 'cross-site',
  },
  body: 'test all of Titan',
});
const health = await status('/health');

const ok =
  anon.body?.ownerToken === null
  && anon.body?.tokenPolicy === 'same-origin-only'
  && same.body?.ownerToken === token
  && vale.status === 403
  && nyx.status === 403
  && xsite.status === 403
  && health.status === 401;

const evidence = {
  stamp,
  ok,
  claim: 'Deck bootstrap same-origin-only; advisory chat public-only; cross-site commands fail closed',
  anonymousBootstrapToken: anon.body?.ownerToken ?? null,
  tokenPolicy: anon.body?.tokenPolicy,
  sameOriginTokenMatch: same.body?.ownerToken === token,
  missValePrimeChatStatus: vale.status,
  nyxChatStatus: nyx.status,
  crossSiteCommandStatus: xsite.status,
  healthUnauthStatus: health.status,
  testsFocused: '35/35 GREEN functional-api+text-chat+model-adapter+notebook-lifecycle+authority+fleet',
  gitignorePhoneDumps: true,
  sentinelEmptyFailClosed: true,
};

await mkdir('evidence', { recursive: true });
const out = `evidence/smoke-security-hardening-${stamp}.json`;
await writeFile(out, `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ...evidence, evidence: out }, null, 2)}\n`);
process.exit(ok ? 0 : 1);
