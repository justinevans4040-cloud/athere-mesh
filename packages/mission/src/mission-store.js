import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostname as systemHostname } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const MISSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const TRANSIENT_SHARING_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);
const DEFAULT_FILESYSTEM = Object.freeze({ mkdir, open, readFile, rename, rm, writeFile });
const LOCK_VERSION = 1;
const DEFAULT_LEASE_MS = 30_000;

function requireMissionId(missionId) {
  if (typeof missionId !== 'string' || !MISSION_ID.test(missionId)) {
    throw new Error('invalid mission id');
  }
  return missionId;
}

function locations(root, missionId) {
  if (typeof root !== 'string' || root.length === 0) throw new TypeError('root must be a path');
  const id = requireMissionId(missionId);
  const directory = path.resolve(root, 'missions');
  return {
    directory,
    snapshot: path.join(directory, `${id}.json`),
    lock: path.join(directory, `.${id}.lock`),
  };
}

function requireFilesystem(filesystem) {
  for (const method of ['mkdir', 'open', 'readFile', 'rename', 'rm', 'writeFile']) {
    if (typeof filesystem?.[method] !== 'function') throw new TypeError(`filesystem must provide ${method}`);
  }
  return filesystem;
}

function requireAttempts(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 16) throw new TypeError('maxTransientAttempts must be between 1 and 16');
  return value;
}

async function retryTransientSharing(operation, { retryDelay, maxTransientAttempts }) {
  for (let attempt = 0; attempt < maxTransientAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!TRANSIENT_SHARING_CODES.has(error?.code) || attempt === maxTransientAttempts - 1) throw error;
      await retryDelay(attempt + 1);
    }
  }
  throw new Error('unreachable transient filesystem retry');
}

function requireClock(clock) {
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  return clock;
}

function requireOwner({ hostname, pid }) {
  if (typeof hostname !== 'string' || hostname.trim().length === 0) throw new TypeError('hostname must be non-empty');
  if (!Number.isSafeInteger(pid) || pid < 1) throw new TypeError('pid must be a positive integer');
  return Object.freeze({ hostname, pid });
}

function requireLeaseMs(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 3_600_000) throw new TypeError('leaseMs must be between 1 and 3600000');
  return value;
}

function requireToken(value) {
  if (typeof value !== 'string' || value.length < 16 || value.length > 256 || /\s/.test(value)) {
    throw new TypeError('lock token must be a non-empty opaque value');
  }
  return value;
}

function lockMetadata({ owner, token, clock, leaseMs }) {
  const acquiredAt = clock();
  const acquiredAtMs = Date.parse(acquiredAt);
  if (typeof acquiredAt !== 'string' || Number.isNaN(acquiredAtMs)) throw new TypeError('clock must return an ISO timestamp');
  return Object.freeze({
    version: LOCK_VERSION,
    owner: Object.freeze({ ...owner, token }),
    lease: Object.freeze({ acquiredAt, expiresAt: new Date(acquiredAtMs + leaseMs).toISOString() }),
  });
}

function parseLockMetadata(content) {
  let metadata;
  try {
    metadata = JSON.parse(content);
  } catch {
    return undefined;
  }
  const acquiredAt = Date.parse(metadata?.lease?.acquiredAt);
  const expiresAt = Date.parse(metadata?.lease?.expiresAt);
  if (metadata?.version !== LOCK_VERSION
    || typeof metadata?.owner?.hostname !== 'string'
    || !Number.isSafeInteger(metadata?.owner?.pid)
    || metadata.owner.pid < 1
    || typeof metadata?.owner?.token !== 'string'
    || metadata.owner.token.length < 16
    || Number.isNaN(acquiredAt)
    || Number.isNaN(expiresAt)
    || expiresAt <= acquiredAt) return undefined;
  return metadata;
}

async function readLockMetadata(operations, lock) {
  try {
    return parseLockMetadata(await operations.readFile(lock, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

async function reclaimDeadOwnerLock({ operations, lock, owner, isProcessAlive }) {
  const candidate = await readLockMetadata(operations, lock);
  if (!candidate || candidate.owner.hostname !== owner.hostname) return false;
  if (await isProcessAlive(candidate.owner.pid) !== false) return false;
  const confirmed = await readLockMetadata(operations, lock);
  if (!confirmed || confirmed.owner.token !== candidate.owner.token) return false;

  const quarantine = `${lock}.stale-${randomUUID()}`;
  try {
    await operations.rename(lock, quarantine);
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    throw error;
  }
  const claimed = await readLockMetadata(operations, quarantine);
  if (!claimed || claimed.owner.token !== candidate.owner.token) {
    throw new Error('mission lock changed during stale-owner reclamation');
  }
  await operations.rm(quarantine, { force: true });
  return true;
}

function expectedCleanupError(operation, error) {
  return error?.code === 'ENOENT' || (operation === 'close' && error?.code === 'EBADF');
}

async function cleanupMissionWrite({ operations, temporary, lockHandle, lock, lockToken, metadataWritten }) {
  const failures = [];
  const attempt = async (operation, work) => {
    try {
      await work();
    } catch (error) {
      if (!expectedCleanupError(operation, error)) {
        failures.push(new Error(`mission cleanup failed: ${operation}`, { cause: error }));
      }
    }
  };
  await attempt('temporary', () => operations.rm(temporary, { force: true }));
  await attempt('close', () => lockHandle.close());
  await attempt('lock', async () => {
    if (metadataWritten) {
      let content;
      try {
        content = await operations.readFile(lock, 'utf8');
      } catch (error) {
        if (error?.code === 'ENOENT') return;
        throw error;
      }
      const metadata = parseLockMetadata(content);
      if (!metadata || metadata.owner.token !== lockToken) throw new Error('mission lock ownership changed');
    }
    await operations.rm(lock, { force: true });
  });
  return failures.length === 0 ? undefined : new AggregateError(failures, 'mission cleanup failed');
}

async function readSnapshot(snapshot, { missing = false, readFileImpl = readFile } = {}) {
  try {
    const parsed = JSON.parse(await readFileImpl(snapshot, 'utf8'));
    if (!Number.isSafeInteger(parsed.revision) || parsed.revision < 1 || !parsed.mission) {
      throw new Error('invalid shape');
    }
    return parsed;
  } catch (error) {
    if (missing && error.code === 'ENOENT') return undefined;
    if (error.code === 'ENOENT') throw new Error('mission snapshot not found');
    throw new Error('corrupt mission snapshot', { cause: error });
  }
}

export async function loadMission({ root, missionId }) {
  return defaultMissionStore.loadMission({ root, missionId });
}

export async function saveMission({ root, mission, expectedRevision }) {
  return defaultMissionStore.saveMission({ root, mission, expectedRevision });
}

export function createMissionStore({
  filesystem = DEFAULT_FILESYSTEM,
  retryDelay = delay,
  maxTransientAttempts = 4,
  hostname = systemHostname(),
  pid = process.pid,
  clock = () => new Date().toISOString(),
  tokenFactory = randomUUID,
  isProcessAlive = defaultIsProcessAlive,
  leaseMs = DEFAULT_LEASE_MS,
} = {}) {
  const operations = requireFilesystem(filesystem);
  if (typeof retryDelay !== 'function') throw new TypeError('retryDelay must be a function');
  const attempts = requireAttempts(maxTransientAttempts);
  const owner = requireOwner({ hostname, pid });
  const lockClock = requireClock(clock);
  if (typeof tokenFactory !== 'function') throw new TypeError('tokenFactory must be a function');
  if (typeof isProcessAlive !== 'function') throw new TypeError('isProcessAlive must be a function');
  const lockLeaseMs = requireLeaseMs(leaseMs);

  async function load({ root, missionId }) {
    const { snapshot } = locations(root, missionId);
    return readSnapshot(snapshot, { readFileImpl: operations.readFile });
  }

  async function save({ root, mission, expectedRevision }) {
    if (!mission || typeof mission !== 'object') throw new TypeError('mission is required');
    const { directory, snapshot, lock } = locations(root, mission.id);
    await operations.mkdir(directory, { recursive: true });

    let lockHandle;
    for (let acquisitionAttempt = 0; acquisitionAttempt < attempts; acquisitionAttempt += 1) {
      try {
        lockHandle = await retryTransientSharing(() => operations.open(lock, 'wx'), { retryDelay, maxTransientAttempts: attempts });
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const reclaimed = await reclaimDeadOwnerLock({ operations, lock, owner, isProcessAlive });
        if (!reclaimed) throw new Error('mission write already in progress');
      }
    }
    if (!lockHandle) throw new Error('mission write already in progress');

    const lockToken = requireToken(tokenFactory());
    let metadataWritten = false;
    try {
      const metadata = lockMetadata({ owner, token: lockToken, clock: lockClock, leaseMs: lockLeaseMs });
      await operations.writeFile(lock, `${JSON.stringify(metadata)}\n`, { encoding: 'utf8', flag: 'w' });
      metadataWritten = true;
    } catch (error) {
      await cleanupMissionWrite({ operations, temporary: `${lock}.metadata`, lockHandle, lock, lockToken, metadataWritten });
      throw error;
    }

    const temporary = path.join(directory, `.${mission.id}.${randomUUID()}.tmp`);
    let result;
    let writeFailure;
    try {
      const current = await readSnapshot(snapshot, { missing: true, readFileImpl: operations.readFile });
      const currentRevision = current?.revision ?? 0;
      if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
        throw new Error(`revision conflict: expected ${expectedRevision}, found ${currentRevision}`);
      }
      if (expectedRevision === undefined && currentRevision !== 0) {
        throw new Error(`revision conflict: mission already exists at revision ${currentRevision}`);
      }

      const record = { revision: currentRevision + 1, mission };
      await operations.writeFile(temporary, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'wx' });
      await retryTransientSharing(() => operations.rename(temporary, snapshot), { retryDelay, maxTransientAttempts: attempts });
      result = record;
    } catch (error) {
      writeFailure = error;
    }
    const cleanupFailure = await cleanupMissionWrite({ operations, temporary, lockHandle, lock, lockToken, metadataWritten });
    if (writeFailure && cleanupFailure) {
      throw new AggregateError([writeFailure, cleanupFailure], 'mission write and cleanup failed');
    }
    if (writeFailure) throw writeFailure;
    if (cleanupFailure) throw cleanupFailure;
    return result;
  }

  return Object.freeze({ loadMission: load, saveMission: save });
}

const defaultMissionStore = createMissionStore();
