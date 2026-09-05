#!/usr/bin/env node
/**
 * Phone mesh attach smoke — Tailscale reachability + optional mesh Redis ping.
 * Uses existing RESP client (no new deps). Phone Redis on :6379 is probed when online.
 */
import { writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRespClient } from '../packages/resonance/src/resp-client.js';
import { resolveRedisResonanceOptions } from '../packages/resonance/src/redis-resonance-bus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

const PHONES = Object.freeze([
  Object.freeze({ id: 'a15', host: '100.111.24.85', label: 'A15 Termux' }),
  Object.freeze({ id: 'kftrwi', host: '100.68.194.71', label: 'kftrwi Termux' }),
  Object.freeze({ id: 's24', host: process.env.ATHERE_S24_TAILSCALE_IP ?? '100.83.225.17', label: 'S24' }),
]);

function pingHost(host) {
  if (!host) return { ok: false, reason: 'no host configured' };
  const result = spawnSync('ping', ['-n', '1', '-w', '2000', host], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return { ok: result.status === 0, status: result.status, stdout: (result.stdout ?? '').slice(0, 400) };
}

function tcpProbe(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ ok: false, reason: 'timeout' });
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve({ ok: true });
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: error.message });
    });
  });
}

async function meshRedisPing() {
  let options;
  try {
    options = resolveRedisResonanceOptions(process.env);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (options === null) {
    return { ok: false, reason: 'ATHERE_MESH_REDIS_* unset' };
  }
  const client = createRespClient(options);
  try {
    await client.connect();
    const pong = await client.command(['PING']);
    await client.close();
    return { ok: pong === 'PONG', pong, host: options.host, port: options.port };
  } catch (error) {
    try { await client.close(); } catch { /* ignore */ }
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

const phoneReach = [];
for (const phone of PHONES) {
  if (!phone.host) {
    phoneReach.push({ ...phone, ping: { ok: false, reason: 'offline / unset' }, redisPort: null });
    continue;
  }
  const ping = pingHost(phone.host);
  const redisPort = ping.ok ? await tcpProbe(phone.host, 6379) : null;
  phoneReach.push({ ...phone, ping, redisPort });
}

const meshRedis = await meshRedisPing();
const anyPhoneOnline = phoneReach.some((p) => p.ping?.ok === true);

const evidence = {
  stamp,
  anyPhoneOnline,
  phones: phoneReach,
  meshRedis,
  termuxJoinHint: [
    'On phone Termux: pkg install redis; start redis on 6379 or publish to Lenovo mesh Redis',
    'tailscale up; confirm ping from Lenovo',
    'Re-run: node scripts/smoke-phone-tailscale.js',
  ],
  ok: anyPhoneOnline === true,
};

const outPath = path.join(repoRoot, 'evidence', `smoke-phone-tailscale-${stamp}.json`);
await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: evidence.ok, outPath, anyPhoneOnline, meshRedisOk: meshRedis.ok }, null, 2));
process.exit(evidence.ok ? 0 : 1);
