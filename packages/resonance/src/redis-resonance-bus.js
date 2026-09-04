import { readFileSync } from 'node:fs';
import { fingerprintSignal, requireSignalId, validateSignal } from './resonance-bus.js';
import { createRespClient } from './resp-client.js';

export const DEFAULT_SEED_KEY = 'athere:mesh:seed:id';
export const DEFAULT_NAMESPACE = 'athere:mesh:resonance';
export const DEFAULT_PORT = 6380;

// The seed guard runs server-side, inside every script, so it is atomic with
// the operation it protects. Checking the identity once per connection is not
// enough: the client reconnects transparently after a dropped socket or a Redis
// restart, so a cached result would let the bus keep operating against whatever
// answers next. That is the silent-empty-stream failure the guard exists to
// prevent. KEYS[1] is the seed key, ARGV[1] the expected identity.
const SEED_GUARD = `
local seed = redis.call('GET', KEYS[1])
if not seed then return redis.error_reply('ATHERE_SEED_MISSING') end
if seed ~= ARGV[1] then return redis.error_reply('ATHERE_SEED_MISMATCH ' .. seed) end
`;

// Publish must also be atomic in itself: the idempotency check, the append and
// the sequence record cannot straddle round trips, or two hosts racing the same
// signal id would either double-append or record a sequence that disagrees with
// the stream. EVAL is core Redis, so this costs no dependency.
//
// KEYS[2] identity record, KEYS[3] mission stream.
// ARGV[2] content fingerprint, ARGV[3] serialized signal.
// Returns { duplicateFlag, sequence }.
const PUBLISH_SCRIPT = `${SEED_GUARD}
local prior = redis.call('GET', KEYS[2])
if prior then
  local separator = string.find(prior, ':', 1, true)
  if separator == nil then
    return redis.error_reply('ATHERE_CORRUPT_IDENTITY_RECORD')
  end
  if string.sub(prior, 1, separator - 1) ~= ARGV[2] then
    return redis.error_reply('ATHERE_IDEMPOTENCY_CONFLICT')
  end
  return {1, tonumber(string.sub(prior, separator + 1))}
end
local sequence = redis.call('RPUSH', KEYS[3], ARGV[3])
redis.call('SET', KEYS[2], ARGV[2] .. ':' .. sequence)
return {0, sequence}
`;

// KEYS[2] mission stream. Read-only, so it runs under EVAL_RO.
const READ_SCRIPT = `${SEED_GUARD}
return redis.call('LRANGE', KEYS[2], 0, -1)
`;

const VERIFY_SEED_SCRIPT = `${SEED_GUARD}
return seed
`;

function optional(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

// Reads connection details from the environment so no password is ever written
// into the repository. Returns null when the mesh transport is not configured,
// which is the offline-first default.
export function resolveRedisResonanceOptions(env = process.env) {
  const url = optional(env.ATHERE_MESH_REDIS_URL);
  const envHost = optional(env.ATHERE_MESH_REDIS_HOST);
  if (url === undefined && envHost === undefined) return null;

  let host = envHost;
  let port = optional(env.ATHERE_MESH_REDIS_PORT);
  let password = env.ATHERE_MESH_REDIS_PASSWORD;

  // Preferred on the seed host, where a mode-600 file keeps the password out of
  // argv and out of any environment a shared box can list.
  const passwordFile = optional(env.ATHERE_MESH_REDIS_PASSWORD_FILE);
  if (passwordFile !== undefined) {
    try {
      password = readFileSync(passwordFile, 'utf8').trim();
    } catch (cause) {
      throw new Error(`ATHERE_MESH_REDIS_PASSWORD_FILE could not be read: ${passwordFile} (${cause.code ?? cause.message})`);
    }
  }

  if (url !== undefined) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`ATHERE_MESH_REDIS_URL is not a valid redis url: ${url}`);
    }
    if (parsed.protocol !== 'redis:') {
      throw new Error(`ATHERE_MESH_REDIS_URL is not a valid redis url: unsupported protocol ${parsed.protocol} (this zero-dependency client speaks plaintext RESP over the tailnet only)`);
    }
    host = parsed.hostname || host;
    port = parsed.port || port;
    if (parsed.password) password = decodeURIComponent(parsed.password);
  }

  if (host === undefined) throw new Error('ATHERE_MESH_REDIS_URL or ATHERE_MESH_REDIS_HOST must resolve a host');

  const expectedSeedId = optional(env.ATHERE_MESH_REDIS_SEED_ID);
  if (expectedSeedId === undefined) {
    throw new Error('ATHERE_MESH_REDIS_SEED_ID is required whenever ATHERE_MESH_REDIS_URL or ATHERE_MESH_REDIS_HOST is set: the bus refuses to run without the mesh seed identity guard');
  }

  const resolvedPort = port === undefined ? DEFAULT_PORT : Number(port);
  if (!Number.isInteger(resolvedPort) || resolvedPort < 1 || resolvedPort > 65_535) {
    throw new Error(`ATHERE_MESH_REDIS_PORT is not a valid port: ${port}`);
  }

  return Object.freeze({
    host,
    port: resolvedPort,
    password: typeof password === 'string' && password.length > 0 ? password : undefined,
    expectedSeedId,
    seedKey: optional(env.ATHERE_MESH_REDIS_SEED_KEY) ?? DEFAULT_SEED_KEY,
    namespace: optional(env.ATHERE_MESH_REDIS_NAMESPACE) ?? DEFAULT_NAMESPACE,
  });
}

export function createRedisResonanceBus({
  host = '127.0.0.1',
  port = DEFAULT_PORT,
  password,
  expectedSeedId,
  seedKey = DEFAULT_SEED_KEY,
  namespace = DEFAULT_NAMESPACE,
  connectTimeoutMs,
  commandTimeoutMs,
} = {}) {
  if (typeof expectedSeedId !== 'string' || expectedSeedId.trim().length === 0) {
    throw new TypeError('expectedSeedId is required: the resonance bus refuses to operate without a mesh seed identity guard');
  }

  const target = `${host}:${port}`;
  const client = createRespClient({ host, port, password, connectTimeoutMs, commandTimeoutMs });

  // Two other Redis units on the seed host compete for port 6379. Pointing the
  // mesh at a different, empty Redis would read an empty stream and look like
  // "no signals yet", so the sentinels the scripts raise become loud errors
  // naming both the expectation and what actually answered.
  function explain(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('ATHERE_SEED_MISSING')) {
      return new Error(`mesh seed identity missing: ${seedKey} is absent on ${target}; refusing to operate`);
    }
    const mismatch = /ATHERE_SEED_MISMATCH (.+)$/.exec(message);
    if (mismatch !== null) {
      return new Error(`mesh seed identity mismatch: expected ${expectedSeedId} at ${seedKey} on ${target}, found ${mismatch[1].trim()}; refusing to operate`);
    }
    if (message.includes('ATHERE_IDEMPOTENCY_CONFLICT')) {
      return new Error('idempotency conflict: signal id already has different content');
    }
    if (message.includes('ATHERE_CORRUPT_IDENTITY_RECORD')) {
      return new Error(`corrupt idempotency record on ${target}: signal identity key does not hold <fingerprint>:<sequence>`);
    }
    return error;
  }

  async function evaluate(command, script, keys, args) {
    try {
      return await client.command([command, script, String(keys.length), ...keys, ...args]);
    } catch (error) {
      throw explain(error);
    }
  }

  function streamKey(missionId) {
    return `${namespace}:mission:${missionId}:signals`;
  }

  function identityKey(signalId) {
    return `${namespace}:signal:${signalId}`;
  }

  // A signal that does not survive JSON must fail loudly here. The memory bus
  // holds object references, so values such as undefined or Date would cross
  // the transport as something different instead of not at all.
  function serialize(signal) {
    const payload = JSON.stringify(signal);
    if (payload === undefined || fingerprintSignal(JSON.parse(payload)) !== fingerprintSignal(signal)) {
      throw new TypeError('signal does not survive transport serialization: remove undefined and non-JSON values');
    }
    return payload;
  }

  return Object.freeze({
    // Returns the seed identity Redis actually served, so evidence records the
    // observed value instead of echoing the configured expectation.
    async verifySeed() {
      return evaluate('EVAL_RO', VERIFY_SEED_SCRIPT, [seedKey], [expectedSeedId]);
    },

    async publish(signal) {
      validateSignal(signal);
      const payload = serialize(signal);
      const [duplicate, sequence] = await evaluate(
        'EVAL',
        PUBLISH_SCRIPT,
        [seedKey, identityKey(signal.id), streamKey(signal.missionId)],
        [expectedSeedId, fingerprintSignal(signal), payload],
      );
      return { accepted: true, duplicate: duplicate === 1, sequence };
    },

    async read({ missionId } = {}) {
      requireSignalId(missionId, 'mission id');
      const entries = await evaluate('EVAL_RO', READ_SCRIPT, [seedKey, streamKey(missionId)], [expectedSeedId]);
      return Object.freeze(entries.map((entry, index) => Object.freeze({ ...JSON.parse(entry), sequence: index + 1 })));
    },

    async close() {
      await client.close();
    },
  });
}
