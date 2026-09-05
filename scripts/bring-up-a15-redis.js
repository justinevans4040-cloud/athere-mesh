#!/usr/bin/env node
/**
 * Wait for A15 Termux SSH (:8022), then install/start Redis and verify from Lenovo.
 */
import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRespClient } from '../packages/resonance/src/resp-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const A15 = process.env.ATHERE_A15_TAILSCALE_IP ?? '100.111.24.85';
const SSH_PORT = Number(process.env.ATHERE_A15_SSH_PORT ?? 8022);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const maxWaitMs = Number(process.env.ATHERE_A15_WAIT_MS ?? 10 * 60 * 1000);
const pollMs = 5000;

function tcpOpen(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function ssh(args, input) {
  const result = spawnSync('ssh', [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=25',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-p', String(SSH_PORT),
    `justi@${A15}`,
    args,
  ], {
    encoding: 'utf8',
    windowsHide: true,
    input,
    timeout: 180_000,
  });
  return result;
}

console.log(JSON.stringify({ waitingFor: `${A15}:${SSH_PORT}`, maxWaitMs }));

const started = Date.now();
let sshReady = false;
while (Date.now() - started < maxWaitMs) {
  sshReady = await tcpOpen(A15, SSH_PORT);
  if (sshReady) break;
  await new Promise((r) => setTimeout(r, pollMs));
  process.stdout.write('.');
}
process.stdout.write('\n');

if (!sshReady) {
  const out = {
    ok: false,
    reason: `SSH ${A15}:${SSH_PORT} never opened`,
    onPhone: [
      'Open Termux on A15',
      'pkg install openssh redis',
      'passwd   # if first time',
      'sshd',
      'Then re-run or wait — this waiter will finish Redis',
    ],
  };
  const outPath = path.join(repoRoot, 'evidence', `smoke-a15-redis-${stamp}.json`);
  await writeFile(outPath, `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({ ok: false, outPath, ...out }));
  process.exit(1);
}

const remote = [
  'set -e',
  'command -v redis-server >/dev/null 2>&1 || pkg install -y redis',
  'mkdir -p "$HOME/.athere-mesh"',
  'if ! (echo PING | redis-cli -h 127.0.0.1 -p 6379 2>/dev/null | grep -q PONG); then',
  '  redis-server --daemonize yes --port 6379 --bind 0.0.0.0 --protected-mode no \\',
  '    --dir "$HOME/.athere-mesh" --pidfile "$HOME/.athere-mesh/redis.pid" \\',
  '    --logfile "$HOME/.athere-mesh/redis.log"',
  '  sleep 1',
  'fi',
  'echo PING | redis-cli -h 127.0.0.1 -p 6379',
  'hostname; whoami',
].join('\n');

const install = ssh(remote);
const localRedis = await tcpOpen(A15, 6379, 3000);
let pong = null;
if (localRedis) {
  try {
    const client = createRespClient({ host: A15, port: 6379 });
    await client.connect();
    pong = await client.command(['PING']);
    await client.close();
  } catch (error) {
    pong = error instanceof Error ? error.message : String(error);
  }
}

const evidence = {
  stamp,
  host: A15,
  sshPort: SSH_PORT,
  sshReady: true,
  installStatus: install.status,
  installStdout: (install.stdout ?? '').slice(0, 800),
  installStderr: (install.stderr ?? '').slice(0, 800),
  redisPortOpen: localRedis,
  pong,
  ok: localRedis === true && pong === 'PONG',
};
const outPath = path.join(repoRoot, 'evidence', `smoke-a15-redis-${stamp}.json`);
await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ ok: evidence.ok, outPath, pong, redisPortOpen: localRedis }, null, 2));
process.exit(evidence.ok ? 0 : 1);
