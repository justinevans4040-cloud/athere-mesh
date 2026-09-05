#!/usr/bin/env node
/**
 * Register every active Tailscale peer into mesh Redis as a mesh device.
 * Discovers peers via `tailscale status --json` (no hard-coded phone list).
 */
import { writeFile, mkdtemp } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';
import { createRespClient } from '../packages/resonance/src/resp-client.js';
import { resolveRedisResonanceOptions } from '../packages/resonance/src/redis-resonance-bus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

function findTailscaleBin() {
  const fromPath = spawnSync('tailscale', ['version'], { encoding: 'utf8', windowsHide: true });
  if (fromPath.status === 0) return 'tailscale';
  const bundled = path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'Tailscale', 'tailscale.exe');
  const probe = spawnSync(bundled, ['version'], { encoding: 'utf8', windowsHide: true });
  if (probe.status === 0) return bundled;
  throw new Error('tailscale CLI not found');
}

function loadTailscaleStatus(bin) {
  const result = spawnSync(bin, ['status', '--json'], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`tailscale status failed: ${result.stderr || result.stdout || result.status}`);
  }
  return JSON.parse(result.stdout);
}

function slugId(hostname) {
  return String(hostname || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'unknown';
}

function peerLabel(node) {
  const hostName = typeof node.HostName === 'string' ? node.HostName.trim() : '';
  const dnsLeaf = typeof node.DNSName === 'string'
    ? node.DNSName.replace(/\.+$/, '').split('.')[0]
    : '';
  if (hostName && hostName.toLowerCase() !== 'localhost') return hostName;
  if (dnsLeaf && dnsLeaf.toLowerCase() !== 'localhost') return dnsLeaf;
  return hostName || dnsLeaf || 'unknown';
}

function listActivePeers(status) {
  const peers = [];
  const self = status.Self;
  if (self?.TailscaleIPs?.[0]) {
    const hostname = peerLabel(self);
    peers.push({
      id: slugId(hostname),
      host: self.TailscaleIPs[0],
      hostname,
      os: self.OS || 'unknown',
      online: true,
      self: true,
      role: inferRole(hostname, self.OS || ''),
    });
  }
  for (const peer of Object.values(status.Peer ?? {})) {
    const online = peer.Online === true;
    if (!online) continue;
    const host = peer.TailscaleIPs?.[0];
    if (!host) continue;
    const hostname = peerLabel(peer);
    peers.push({
      id: slugId(hostname),
      host,
      hostname,
      os: peer.OS || 'unknown',
      online: true,
      self: false,
      role: inferRole(hostname, peer.OS || ''),
    });
  }
  return peers;
}

function inferRole(hostname, os) {
  const h = hostname.toLowerCase();
  if (h.includes('ichabod')) return 'worker';
  if (h.includes('lenovo') || os.toLowerCase() === 'windows') return 'owner';
  if (os.toLowerCase() === 'android' || os.toLowerCase() === 'ios') return 'phone';
  if (os.toLowerCase() === 'linux') return 'node';
  return 'peer';
}

function pingOk(host) {
  return spawnSync('ping', ['-n', '1', '-w', '2000', host], { windowsHide: true }).status === 0;
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

const bin = findTailscaleBin();
const status = loadTailscaleStatus(bin);
const active = listActivePeers(status);
const offline = Object.values(status.Peer ?? {})
  .filter((peer) => peer.Online !== true)
  .map((peer) => ({
    hostname: peer.HostName || peer.DNSName,
    host: peer.TailscaleIPs?.[0] ?? null,
    os: peer.OS,
    online: false,
    lastSeen: peer.LastSeen ?? null,
  }));

const options = resolveRedisResonanceOptions(process.env);
if (options === null) {
  console.error(JSON.stringify({ ok: false, reason: 'ATHERE_MESH_REDIS_* unset' }));
  process.exit(1);
}

const client = createRespClient(options);
await client.connect();
await client.command(['DEL', 'athere:device:active']);

const registered = [];
for (const peer of active) {
  const reachable = peer.self === true ? true : pingOk(peer.host);
  const ports = {
    redis6379: await tcpProbe(peer.host, 6379),
    meshRedis6380: await tcpProbe(peer.host, 6380),
    ssh22: await tcpProbe(peer.host, 22),
    ssh8022: await tcpProbe(peer.host, 8022),
  };
  const key = `athere:device:${peer.id}:last-seen`;
  const legacyPhoneKey = peer.role === 'phone' ? `athere:phone:${peer.id}:last-seen` : null;
  const payload = JSON.stringify({
    at: stamp,
    host: peer.host,
    hostname: peer.hostname,
    os: peer.os,
    role: peer.role,
    via: 'tailscale-fleet-register',
    ports,
  });
  if (!reachable) {
    registered.push({ ...peer, ok: false, reason: 'ping failed', ports });
    continue;
  }
  await client.command(['SET', key, payload, 'EX', '3600']);
  const got = await client.command(['GET', key]);
  if (legacyPhoneKey) {
    await client.command(['SET', legacyPhoneKey, payload, 'EX', '3600']);
  }
  await client.command(['SADD', 'athere:device:active', peer.id]);
  registered.push({
    ...peer,
    ok: got === payload,
    key,
    ...(legacyPhoneKey ? { legacyPhoneKey } : {}),
    ports,
  });
}
await client.command(['EXPIRE', 'athere:device:active', 3600]);
const fleetMembers = await client.command(['SMEMBERS', 'athere:device:active']);
await client.close();

const ok = active.length > 0 && registered.every((entry) => entry.ok === true);
const evidence = {
  stamp,
  ok,
  activeCount: active.length,
  offlineCount: offline.length,
  fleetMembers: Array.isArray(fleetMembers) ? fleetMembers.sort() : fleetMembers,
  registered,
  offline,
};
const outPath = path.join(repoRoot, 'evidence', `smoke-tailscale-fleet-${stamp}.json`);
await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  ok,
  outPath,
  activeCount: active.length,
  fleetMembers: evidence.fleetMembers,
  devices: registered.map((d) => ({
    id: d.id,
    host: d.host,
    hostname: d.hostname,
    role: d.role,
    ok: d.ok,
    redis6379: d.ports?.redis6379?.ok === true,
    meshRedis6380: d.ports?.meshRedis6380?.ok === true,
    ssh8022: d.ports?.ssh8022?.ok === true,
  })),
}, null, 2));
process.exit(ok ? 0 : 1);
