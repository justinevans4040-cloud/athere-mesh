#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTitanService } from './start-agent-api.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

async function main() {
  const environment = {
    ...process.env,
    TITAN_API_BEARER_TOKEN: process.env.TITAN_API_BEARER_TOKEN || 'deck-smoke-token-0123456789abcdef01234567',
    TITAN_API_PORT: process.env.TITAN_API_PORT || '0',
    TITAN_DECK_HOST_LABEL: process.env.TITAN_DECK_HOST_LABEL || 'lenovo-smoke',
    TITAN_WORKSPACE_ROOT: process.env.TITAN_WORKSPACE_ROOT || 'workspace/titan-deck-smoke',
  };
  const api = await createTitanService({ environment, repositoryRoot: root });
  await api.listen({ host: '127.0.0.1', port: Number.parseInt(environment.TITAN_API_PORT, 10) || 0 });
  try {
    const home = await fetch(`${api.url}/`);
    const html = await home.text();
    const boot = await (await fetch(`${api.url}/api/deck/bootstrap`)).json();
    const cssOk = (await fetch(`${api.url}/deck.css`)).ok;
    const jsOk = (await fetch(`${api.url}/deck.js`)).ok;
    const evidence = {
      stamp,
      ok: home.status === 200 && cssOk && jsOk && html.includes('COMMAND DECK') && boot.ui === '/',
      url: api.url,
      uiStatus: home.status,
      cssOk,
      jsOk,
      hostLabel: boot.hostLabel,
      brand: boot.brand,
      htmlBytes: Buffer.byteLength(html),
      hasBrandLine: /There is a/.test(html),
    };
    const outDir = path.join(root, 'evidence');
    await mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `smoke-command-deck-${stamp}.json`);
    await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ...evidence, evidence: outPath }, null, 2)}\n`);
    if (!evidence.ok) process.exitCode = 1;
  } finally {
    await api.close();
  }
}

await main();
