import {
  createRedisRemoteWorkQueue,
  resolveRemoteWorkQueueOptions,
} from '../../execution/src/remote-work-queue.js';
import { openSharedMissionStateStore } from '../../postgres/src/postgres-mission-state-store.js';
import {
  createRedisResonanceBus,
  resolveRedisResonanceOptions,
} from '../../resonance/src/redis-resonance-bus.js';

function optional(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Operator flags that mean "on". Empty / unset stays offline.
 */
export function truthyEnvFlag(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

/**
 * Resolve production mesh deps from env for start-agent-api / owner path.
 *
 * Offline default (no ATHERE_MESH_REDIS_*): returns empty wiring — caller keeps
 * memory bus + filesystem store + local executor.
 *
 * When Redis is configured: injects the Redis resonance bus (failClosedOnPublish).
 * When Redis + ATHERE_MESH_REMOTE_WORK_QUEUE are set: also injects the remote
 * work queue. Shared Postgres is injected independently when configured.
 *
 * Returned handle owns live clients; callers must close().
 */
export async function resolveMeshOrchestratorDeps(env = process.env) {
  if (!env || typeof env !== 'object') throw new TypeError('environment is required');

  const closers = [];
  const wired = {
    redisBus: false,
    remoteWorkQueue: false,
    sharedMissionStore: false,
  };

  let bus;
  let remoteWorkQueue;
  let remoteRepositoryRoot;
  let store;

  const wantRemoteQueue = truthyEnvFlag(env.ATHERE_MESH_REMOTE_WORK_QUEUE);
  const redisOptions = resolveRedisResonanceOptions(env);

  if (redisOptions === null) {
    if (wantRemoteQueue) {
      throw new Error(
        'ATHERE_MESH_REMOTE_WORK_QUEUE requires ATHERE_MESH_REDIS_URL or ATHERE_MESH_REDIS_HOST together with ATHERE_MESH_REDIS_SEED_ID',
      );
    }
  } else {
    const redisBus = createRedisResonanceBus(redisOptions);
    closers.push(() => redisBus.close());
    bus = redisBus;
    wired.redisBus = true;

    if (wantRemoteQueue) {
      const workOptions = resolveRemoteWorkQueueOptions(env);
      if (workOptions === null) {
        throw new Error('remote work queue options could not be resolved from ATHERE_MESH_REDIS_*');
      }
      const queue = createRedisRemoteWorkQueue(workOptions);
      closers.push(() => queue.close());
      remoteWorkQueue = queue;
      wired.remoteWorkQueue = true;
      remoteRepositoryRoot = optional(env.ATHERE_MESH_REMOTE_REPOSITORY_ROOT);
    }
  }

  const shared = await openSharedMissionStateStore(env);
  if (shared !== null) {
    closers.push(() => shared.close());
    store = shared.store;
    wired.sharedMissionStore = true;
  }

  return Object.freeze({
    bus,
    remoteWorkQueue,
    remoteRepositoryRoot,
    store,
    wired: Object.freeze(wired),
    async close() {
      const errors = [];
      for (const closer of closers.reverse()) {
        try {
          await closer();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) {
        const aggregate = new Error(`mesh env wiring close failed (${errors.length})`);
        aggregate.cause = errors[0];
        throw aggregate;
      }
    },
  });
}
