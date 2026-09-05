#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRespClient } from '../packages/resonance/src/resp-client.js';
import { resolveRedisResonanceOptions } from '../packages/resonance/src/redis-resonance-bus.js';

const S24 = process.env.ATHERE_S24_TAILSCALE_IP ?? '100.83.225.17';
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

const phone = createRespClient({ host: S24, port: 6379 });
await phone.connect();
const pong = await phone.command(['PING']);
await phone.close();

const ssh = spawnSync('ssh', [
  '-o', 'BatchMode=yes',
  '-o', 'ConnectTimeout=15',
  '-p', '8022',
  `justi@${S24}`,
  'echo ok; whoami; echo PING | redis-cli',
], { encoding: 'utf8', windowsHide: true });

const options = resolveRedisResonanceOptions(process.env);
if (options === null) throw new Error('ATHERE_MESH_REDIS_* unset');
const mesh = createRespClient(options);
await mesh.connect();
const payload = JSON.stringify({
  at: stamp,
  host: S24,
  hostname: 'Justins-S24',
  role: 'phone',
  redis6379: true,
  ssh8022: true,
  pong,
  via: 's24-primary-phone',
  a15: 'parked',
});
await mesh.command(['SET', 'athere:device:justin-s-s24:last-seen', payload, 'EX', '7200']);
await mesh.command(['SET', 'athere:phone:s24:last-seen', payload, 'EX', '7200']);
await mesh.command(['SADD', 'athere:device:active', 'justin-s-s24']);
await mesh.command(['SET', 'athere:phone:primary', 's24', 'EX', '7200']);
await mesh.close();

const evidence = {
  stamp,
  ok: pong === 'PONG' && ssh.status === 0,
  primaryPhone: 's24',
  a15: 'parked',
  s24: {
    host: S24,
    pong,
    sshStatus: ssh.status,
    sshOut: (ssh.stdout || '').trim().slice(0, 300),
  },
};
const outPath = `evidence/smoke-s24-primary-${stamp}.json`;
await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ...evidence, outPath }, null, 2));
process.exit(evidence.ok ? 0 : 1);
