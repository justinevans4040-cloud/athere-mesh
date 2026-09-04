import { createHash, randomUUID } from 'node:crypto';
import { createRespClient } from '../../resonance/src/resp-client.js';
import {
  DEFAULT_NAMESPACE as RESONANCE_DEFAULT_NAMESPACE,
  DEFAULT_PORT,
  DEFAULT_SEED_KEY,
  resolveRedisResonanceOptions,
} from '../../resonance/src/redis-resonance-bus.js';

export const DEFAULT_WORK_NAMESPACE = 'athere:mesh:work';
export const DEFAULT_LEASE_MS = 60_000;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const JOB_KINDS = new Set(['run-node-tests', 'inspect-repository']);

const SEED_GUARD = `
local seed = redis.call('GET', KEYS[1])
if not seed then return redis.error_reply('ATHERE_SEED_MISSING') end
if seed ~= ARGV[1] then return redis.error_reply('ATHERE_SEED_MISMATCH ' .. seed) end
`;

// KEYS[2] job payload, KEYS[3] queue list.
// ARGV[2] content fingerprint, ARGV[3] serialized job, ARGV[4] job id.
const ENQUEUE_SCRIPT = `${SEED_GUARD}
local priorFp = redis.call('GET', KEYS[2] .. ':fp')
if priorFp then
  if priorFp ~= ARGV[2] then
    return redis.error_reply('ATHERE_IDEMPOTENCY_CONFLICT')
  end
  return {1}
end
redis.call('SET', KEYS[2], ARGV[3])
redis.call('SET', KEYS[2] .. ':fp', ARGV[2])
redis.call('RPUSH', KEYS[3], ARGV[4])
return {0}
`;

// KEYS[2] queue, KEYS[3] job prefix, KEYS[4] processing zset (score = lease expiry ms).
// ARGV[2] workerId, ARGV[3] nowMs, ARGV[4] leaseMs.
const CLAIM_SCRIPT = `${SEED_GUARD}
local now = tonumber(ARGV[3])
local expired = redis.call('ZRANGEBYSCORE', KEYS[4], '-inf', now)
for _, expiredId in ipairs(expired) do
  redis.call('ZREM', KEYS[4], expiredId)
  redis.call('DEL', KEYS[3] .. ':' .. expiredId .. ':claimed')
  redis.call('RPUSH', KEYS[2], expiredId)
end
local jobId = redis.call('LPOP', KEYS[2])
if not jobId then return false end
local payload = redis.call('GET', KEYS[3] .. ':' .. jobId)
if not payload then return redis.error_reply('ATHERE_MISSING_JOB ' .. jobId) end
local expires = now + tonumber(ARGV[4])
redis.call('ZADD', KEYS[4], expires, jobId)
redis.call('SET', KEYS[3] .. ':' .. jobId .. ':claimed', ARGV[2])
return payload
`;

// KEYS[2] result key, KEYS[3] processing zset, KEYS[4] claimed key.
// ARGV[2] serialized result, ARGV[3] jobId.
const COMPLETE_SCRIPT = `${SEED_GUARD}
redis.call('SET', KEYS[2], ARGV[2])
redis.call('ZREM', KEYS[3], ARGV[3])
redis.call('DEL', KEYS[4])
return 1
`;

const RESULT_SCRIPT = `${SEED_GUARD}
return redis.call('GET', KEYS[2])
`;

// KEYS[2] processing zset, KEYS[3] claimed key.
// ARGV[2] workerId, ARGV[3] jobId, ARGV[4] nowMs, ARGV[5] leaseMs.
const HEARTBEAT_SCRIPT = `${SEED_GUARD}
local holder = redis.call('GET', KEYS[3])
if not holder then return redis.error_reply('ATHERE_LEASE_MISSING') end
if holder ~= ARGV[2] then return redis.error_reply('ATHERE_LEASE_HOLDER_MISMATCH') end
local score = redis.call('ZSCORE', KEYS[2], ARGV[3])
if not score then return redis.error_reply('ATHERE_LEASE_MISSING') end
local expires = tonumber(ARGV[4]) + tonumber(ARGV[5])
redis.call('ZADD', KEYS[2], expires, ARGV[3])
return expires
`;

// KEYS[2] queue, KEYS[3] job prefix, KEYS[4] processing zset.
// ARGV[2] nowMs. Returns count reclaimed.
const RECLAIM_SCRIPT = `${SEED_GUARD}
local now = tonumber(ARGV[2])
local expired = redis.call('ZRANGEBYSCORE', KEYS[4], '-inf', now)
local count = 0
for _, expiredId in ipairs(expired) do
  redis.call('ZREM', KEYS[4], expiredId)
  redis.call('DEL', KEYS[3] .. ':' .. expiredId .. ':claimed')
  redis.call('RPUSH', KEYS[2], expiredId)
  count = count + 1
end
return count
`;

function requireId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) throw new Error(`invalid ${label}`);
  return value;
}

function requireLeaseMs(leaseMs) {
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 3_600_000) {
    throw new TypeError('leaseMs must be an integer from 1 through 3600000');
  }
  return leaseMs;
}

function fingerprint(value) {
  const ordered = Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

function validateJob(job) {
  if (!job || typeof job !== 'object') throw new TypeError('job is required');
  requireId(job.id, 'job id');
  if (!JOB_KINDS.has(job.kind)) throw new Error(`unsupported job kind: ${job.kind}`);
  requireId(job.missionId, 'mission id');
  if (typeof job.repositoryRoot !== 'string' || job.repositoryRoot.trim().length === 0) {
    throw new TypeError('job.repositoryRoot is required');
  }
  if (!job.envelope || typeof job.envelope !== 'object') throw new TypeError('job.envelope is required');
}

function validateResult(result) {
  if (!result || typeof result !== 'object') throw new TypeError('result is required');
  requireId(result.jobId, 'result job id');
  if (typeof result.ok !== 'boolean') throw new TypeError('result.ok must be boolean');
  if (!result.worker || typeof result.worker.hostname !== 'string') {
    throw new TypeError('result.worker.hostname is required');
  }
  if (typeof result.completedAt !== 'string' || result.completedAt.length === 0) {
    throw new TypeError('result.completedAt is required');
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serialize(value, label) {
  const payload = JSON.stringify(value);
  if (payload === undefined || fingerprint(JSON.parse(payload)) !== fingerprint(value)) {
    throw new TypeError(`${label} does not survive transport serialization: remove undefined and non-JSON values`);
  }
  return payload;
}

export function resolveRemoteWorkQueueOptions(env = process.env) {
  const base = resolveRedisResonanceOptions(env);
  if (base === null) return null;
  const namespace = typeof env.ATHERE_MESH_WORK_NAMESPACE === 'string' && env.ATHERE_MESH_WORK_NAMESPACE.trim().length > 0
    ? env.ATHERE_MESH_WORK_NAMESPACE.trim()
    : DEFAULT_WORK_NAMESPACE;
  return Object.freeze({
    host: base.host,
    port: base.port,
    password: base.password,
    expectedSeedId: base.expectedSeedId,
    seedKey: base.seedKey,
    namespace,
  });
}

export function createMemoryRemoteWorkQueue({ defaultLeaseMs = DEFAULT_LEASE_MS } = {}) {
  const jobs = new Map();
  const fingerprints = new Map();
  const pending = [];
  const results = new Map();
  const waiters = new Map();
  const leases = new Map();

  function wake(jobId) {
    const list = waiters.get(jobId) ?? [];
    waiters.delete(jobId);
    for (const resolve of list) resolve();
  }

  function reclaimExpiredInternal(now = Date.now()) {
    let count = 0;
    for (const [jobId, lease] of [...leases.entries()]) {
      if (lease.expiresAt > now) continue;
      leases.delete(jobId);
      pending.push(jobId);
      count += 1;
    }
    return count;
  }

  return Object.freeze({
    failClosedOnPublish: false,

    async enqueue(job) {
      validateJob(job);
      const hash = fingerprint(job);
      const prior = fingerprints.get(job.id);
      if (prior !== undefined) {
        if (prior !== hash) throw new Error('idempotency conflict: job id already has different content');
        return { accepted: true, duplicate: true };
      }
      jobs.set(job.id, Object.freeze({ ...job }));
      fingerprints.set(job.id, hash);
      pending.push(job.id);
      return { accepted: true, duplicate: false };
    },

    async claim({ workerId, timeoutMs = 0, leaseMs = defaultLeaseMs } = {}) {
      requireId(workerId, 'worker id');
      const leaseDuration = requireLeaseMs(leaseMs);
      const deadline = Date.now() + Math.max(0, timeoutMs);
      for (;;) {
        reclaimExpiredInternal();
        const jobId = pending.shift();
        if (jobId !== undefined) {
          const job = jobs.get(jobId);
          if (job === undefined) throw new Error(`missing job payload for ${jobId}`);
          const claimedAt = new Date().toISOString();
          leases.set(jobId, {
            workerId,
            expiresAt: Date.now() + leaseDuration,
          });
          return Object.freeze({
            ...job,
            claimedBy: workerId,
            claimedAt,
            leaseExpiresAt: new Date(leases.get(jobId).expiresAt).toISOString(),
          });
        }
        if (Date.now() >= deadline) return null;
        await sleep(Math.min(25, Math.max(1, deadline - Date.now())));
      }
    },

    async heartbeat({ jobId, workerId, leaseMs = defaultLeaseMs } = {}) {
      requireId(jobId, 'job id');
      requireId(workerId, 'worker id');
      const leaseDuration = requireLeaseMs(leaseMs);
      const lease = leases.get(jobId);
      if (lease === undefined) throw new Error(`lease missing for ${jobId}`);
      if (lease.workerId !== workerId) throw new Error(`lease holder mismatch for ${jobId}`);
      lease.expiresAt = Date.now() + leaseDuration;
      return { accepted: true, leaseExpiresAt: new Date(lease.expiresAt).toISOString() };
    },

    async reclaimExpired() {
      return { reclaimed: reclaimExpiredInternal() };
    },

    async complete(result) {
      validateResult(result);
      if (!jobs.has(result.jobId)) throw new Error(`unknown job id: ${result.jobId}`);
      leases.delete(result.jobId);
      const frozen = Object.freeze({ ...result });
      results.set(result.jobId, frozen);
      wake(result.jobId);
      return { accepted: true };
    },

    async awaitResult(jobId, { timeoutMs = 30_000, pollMs = 50 } = {}) {
      requireId(jobId, 'job id');
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const existing = results.get(jobId);
        if (existing !== undefined) return existing;
        if (Date.now() >= deadline) throw new Error(`timed out waiting for remote job result: ${jobId}`);
        await Promise.race([
          new Promise((resolve) => {
            const list = waiters.get(jobId) ?? [];
            list.push(resolve);
            waiters.set(jobId, list);
          }),
          sleep(pollMs),
        ]);
      }
    },

    async close() {},
  });
}

export function createRedisRemoteWorkQueue({
  host = '127.0.0.1',
  port = DEFAULT_PORT,
  password,
  expectedSeedId,
  seedKey = DEFAULT_SEED_KEY,
  namespace = DEFAULT_WORK_NAMESPACE,
  connectTimeoutMs,
  commandTimeoutMs,
  defaultLeaseMs = DEFAULT_LEASE_MS,
} = {}) {
  if (typeof expectedSeedId !== 'string' || expectedSeedId.trim().length === 0) {
    throw new TypeError('expectedSeedId is required: the work queue refuses to operate without a mesh seed identity guard');
  }

  const target = `${host}:${port}`;
  const client = createRespClient({ host, port, password, connectTimeoutMs, commandTimeoutMs });

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
      return new Error('idempotency conflict: job id already has different content');
    }
    if (message.includes('ATHERE_MISSING_JOB')) {
      return new Error(`corrupt work queue on ${target}: claimed job id has no payload`);
    }
    if (message.includes('ATHERE_LEASE_MISSING')) {
      return new Error(`lease missing on ${target}`);
    }
    if (message.includes('ATHERE_LEASE_HOLDER_MISMATCH')) {
      return new Error(`lease holder mismatch on ${target}`);
    }
    return error;
  }

  async function evaluate(script, keys, args) {
    try {
      return await client.command(['EVAL', script, String(keys.length), ...keys, ...args]);
    } catch (error) {
      throw explain(error);
    }
  }

  function queueKey() {
    return `${namespace}:queue`;
  }

  function jobKey(jobId) {
    return `${namespace}:job:${jobId}`;
  }

  function resultKey(jobId) {
    return `${namespace}:result:${jobId}`;
  }

  function jobPrefix() {
    return `${namespace}:job`;
  }

  function processingKey() {
    return `${namespace}:processing`;
  }

  function claimedKey(jobId) {
    return `${namespace}:job:${jobId}:claimed`;
  }

  return Object.freeze({
    // Same contract marker the Redis resonance bus exposes so callers that
    // inject this queue alongside a network bus can fail closed uniformly.
    failClosedOnPublish: true,

    async enqueue(job) {
      validateJob(job);
      const payload = serialize(job, 'job');
      const [duplicate] = await evaluate(
        ENQUEUE_SCRIPT,
        [seedKey, jobKey(job.id), queueKey()],
        [expectedSeedId, fingerprint(job), payload, job.id],
      );
      return { accepted: true, duplicate: duplicate === 1 };
    },

    async claim({ workerId, timeoutMs = 0, leaseMs = defaultLeaseMs } = {}) {
      requireId(workerId, 'worker id');
      const leaseDuration = requireLeaseMs(leaseMs);
      const deadline = Date.now() + Math.max(0, timeoutMs);
      for (;;) {
        const now = Date.now();
        const payload = await evaluate(
          CLAIM_SCRIPT,
          [seedKey, queueKey(), jobPrefix(), processingKey()],
          [expectedSeedId, workerId, String(now), String(leaseDuration)],
        );
        if (payload) {
          const job = JSON.parse(payload);
          return Object.freeze({
            ...job,
            claimedBy: workerId,
            claimedAt: new Date().toISOString(),
            leaseExpiresAt: new Date(now + leaseDuration).toISOString(),
          });
        }
        if (Date.now() >= deadline) return null;
        await sleep(Math.min(100, Math.max(1, deadline - Date.now())));
      }
    },

    async heartbeat({ jobId, workerId, leaseMs = defaultLeaseMs } = {}) {
      requireId(jobId, 'job id');
      requireId(workerId, 'worker id');
      const leaseDuration = requireLeaseMs(leaseMs);
      const now = Date.now();
      const expires = await evaluate(
        HEARTBEAT_SCRIPT,
        [seedKey, processingKey(), claimedKey(jobId)],
        [expectedSeedId, workerId, jobId, String(now), String(leaseDuration)],
      );
      return { accepted: true, leaseExpiresAt: new Date(Number(expires)).toISOString() };
    },

    async reclaimExpired() {
      const reclaimed = await evaluate(
        RECLAIM_SCRIPT,
        [seedKey, queueKey(), jobPrefix(), processingKey()],
        [expectedSeedId, String(Date.now())],
      );
      return { reclaimed: Number(reclaimed) };
    },

    async complete(result) {
      validateResult(result);
      const payload = serialize(result, 'result');
      await evaluate(
        COMPLETE_SCRIPT,
        [seedKey, resultKey(result.jobId), processingKey(), claimedKey(result.jobId)],
        [expectedSeedId, payload, result.jobId],
      );
      return { accepted: true };
    },

    async awaitResult(jobId, { timeoutMs = 30_000, pollMs = 100 } = {}) {
      requireId(jobId, 'job id');
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const payload = await evaluate(RESULT_SCRIPT, [seedKey, resultKey(jobId)], [expectedSeedId]);
        if (payload) return Object.freeze(JSON.parse(payload));
        if (Date.now() >= deadline) throw new Error(`timed out waiting for remote job result: ${jobId}`);
        await sleep(pollMs);
      }
    },

    async close() {
      await client.close();
    },
  });
}

export function newJobId() {
  return `job-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

// Re-export resonance defaults used by callers that already import this module.
export { DEFAULT_PORT, DEFAULT_SEED_KEY, RESONANCE_DEFAULT_NAMESPACE };
