import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRedisResonanceBus, resolveRedisResonanceOptions } from '../packages/resonance/src/redis-resonance-bus.js';

// Cross-host resonance smoke. The same script runs on both hosts:
//
//   node scripts/smoke-redis-resonance.js publish --mission <id> --signal <id>
//   node scripts/smoke-redis-resonance.js read    --mission <id>
//
// Connection details come from ATHERE_MESH_REDIS_* only, so no password is ever
// written into this repository. Prints one JSON object on stdout.

const USAGE = 'usage: node scripts/smoke-redis-resonance.js <publish|read> [--mission id] [--signal id] [--agent id] [--type accepted|running|blocked|completed] [--at iso8601] [--detail text]';

function parseArgs(argv) {
  const mode = argv[0];
  if (mode !== 'publish' && mode !== 'read') throw new Error(USAGE);
  const flags = {};
  for (let index = 1; index < argv.length; index += 2) {
    const name = argv[index];
    if (!name.startsWith('--')) throw new Error(USAGE);
    flags[name.slice(2)] = argv[index + 1];
  }
  return { mode, flags };
}

// Self-reported tailnet identity. 100.64.0.0/10 is the CGNAT range Tailscale
// assigns, so this reads the real interface rather than trusting a flag.
function tailnetAddresses() {
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, addresses]) => (addresses ?? []).map((address) => ({ name, ...address })))
    .filter((address) => address.family === 'IPv4' && Number(address.address.split('.')[1]) >= 64
      && Number(address.address.split('.')[1]) <= 127 && address.address.startsWith('100.'))
    .map((address) => ({ interface: address.name, address: address.address }));
}

function identity() {
  return {
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()}`,
    nodeVersion: process.version,
    tailnet: tailnetAddresses(),
    pid: process.pid,
  };
}

const { mode, flags } = parseArgs(process.argv.slice(2));
const options = resolveRedisResonanceOptions(process.env);
if (options === null) {
  throw new Error('ATHERE_MESH_REDIS_URL or ATHERE_MESH_REDIS_HOST must be set, together with ATHERE_MESH_REDIS_SEED_ID');
}

const missionId = flags.mission ?? `mission-smoke-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const bus = createRedisResonanceBus(options);
const startedAt = new Date().toISOString();
const report = {
  ok: false,
  smoke: 'redis-resonance',
  mode,
  process: identity(),
  seed: {
    host: options.host,
    port: options.port,
    seedKey: options.seedKey,
    expectedSeedId: options.expectedSeedId,
    namespace: options.namespace,
    // Proof of which Redis answered, read back through the identity guard.
    verifiedSeedId: null,
  },
  missionId,
  startedAt,
  finishedAt: null,
};

try {
  if (mode === 'publish') {
    const signal = {
      id: flags.signal ?? `${missionId}-s1`,
      missionId,
      type: flags.type ?? 'running',
      agent: flags.agent ?? 'titan',
      // --at and --detail let a replay reproduce a signal byte for byte, which
      // is what makes the idempotency claim testable across processes.
      at: flags.at ?? startedAt,
      detail: flags.detail ?? `cross-host resonance handoff from ${os.hostname()}`,
    };
    report.published = { signal, result: await bus.publish(signal) };
  } else {
    report.read = await bus.read({ missionId });
  }
  report.seed.verifiedSeedId = await bus.verifySeed();
  report.ok = true;
} finally {
  report.finishedAt = new Date().toISOString();
  await bus.close();
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
