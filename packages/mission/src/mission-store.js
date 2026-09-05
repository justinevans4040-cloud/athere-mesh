import { link, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostname as systemHostname, platform as systemPlatform } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const MISSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SNAPSHOT = /^([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.json$/;
const TRANSIENT_SHARING_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);
const DEFAULT_FILESYSTEM = Object.freeze({ link, mkdir, open, readFile, readdir, rename, rm, stat, writeFile });
const LEGACY_LOCK_VERSION = 1;
const LOCK_VERSION = 2;
const DEFAULT_LEASE_MS = 30_000;
const keyedLockTails = new Map();
const BRANDED_MISSION_STORES = new WeakSet();

export function isBrandedMissionStore(value) {
  return value != null && BRANDED_MISSION_STORES.has(value);
}

/** Brand a load/save adapter (Postgres bridge, hermetic Map stores). Not for anonymous hostile objects. */
export function createMissionStoreBridge({ loadMission, saveMission, listMissionIds } = {}) {
  if (typeof loadMission !== 'function' || typeof saveMission !== 'function') {
    throw new TypeError('mission store bridge must provide loadMission and saveMission');
  }
  const store = Object.freeze({
    loadMission,
    saveMission,
    ...(typeof listMissionIds === 'function' ? { listMissionIds } : {}),
  });
  BRANDED_MISSION_STORES.add(store);
  return store;
}

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
  for (const method of ['link', 'mkdir', 'open', 'readFile', 'rename', 'rm', 'stat', 'writeFile']) {
    if (typeof filesystem?.[method] !== 'function') throw new TypeError(`filesystem must provide ${method}`);
  }
  if (filesystem.readdir !== undefined && typeof filesystem.readdir !== 'function') {
    throw new TypeError('filesystem must provide readdir');
  }
  if (typeof filesystem.readdir === 'function') return filesystem;
  // Legacy test mocks omit readdir; listMissionIds then sees an empty missions dir.
  return Object.freeze({
    ...filesystem,
    async readdir() {
      const error = new Error('ENOENT');
      error.code = 'ENOENT';
      throw error;
    },
  });
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

async function withKeyedLock(key, work) {
  const previous = keyedLockTails.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const tail = previous.then(() => gate);
  keyedLockTails.set(key, tail);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (keyedLockTails.get(key) === tail) keyedLockTails.delete(key);
  }
}

function identityFields(identity) {
  const bootId = typeof identity?.bootId === 'string' && identity.bootId.length > 0 ? identity.bootId : undefined;
  const processStartTicks = typeof identity?.processStartTicks === 'string' && /^\d+$/.test(identity.processStartTicks)
    ? identity.processStartTicks
    : undefined;
  return bootId && processStartTicks ? { bootId, processStartTicks } : {};
}

async function lockMetadata({ owner, token, clock, leaseMs, readProcessIdentity }) {
  const acquiredAt = clock();
  const acquiredAtMs = Date.parse(acquiredAt);
  if (typeof acquiredAt !== 'string' || Number.isNaN(acquiredAtMs)) throw new TypeError('clock must return an ISO timestamp');
  const processIdentity = await readProcessIdentity(owner.pid);
  return Object.freeze({
    version: LOCK_VERSION,
    owner: Object.freeze({ ...owner, token, ...identityFields(processIdentity) }),
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
  if (![LEGACY_LOCK_VERSION, LOCK_VERSION].includes(metadata?.version)
    || typeof metadata?.owner?.hostname !== 'string'
    || !Number.isSafeInteger(metadata?.owner?.pid)
    || metadata.owner.pid < 1
    || typeof metadata?.owner?.token !== 'string'
    || metadata.owner.token.length < 16
    || Number.isNaN(acquiredAt)
    || Number.isNaN(expiresAt)
    || expiresAt <= acquiredAt) return undefined;
  if (metadata.version === LOCK_VERSION) {
    const bootId = metadata.owner.bootId;
    const processStartTicks = metadata.owner.processStartTicks;
    const hasBootId = typeof bootId === 'string' && bootId.length > 0 && bootId.length <= 256;
    const hasProcessStart = typeof processStartTicks === 'string' && /^\d+$/.test(processStartTicks);
    const hasIdentityProperty = bootId !== undefined || processStartTicks !== undefined;
    if (hasIdentityProperty && (!hasBootId || !hasProcessStart)) return undefined;
  }
  return metadata;
}

function fileIdentity(value) {
  return Object.freeze({
    dev: String(value.dev),
    ino: String(value.ino),
    size: value.size,
    mtimeMs: value.mtimeMs,
  });
}

function sameFileIdentity(left, right) {
  return left?.dev === right?.dev
    && left?.ino === right?.ino
    && left?.size === right?.size
    && left?.mtimeMs === right?.mtimeMs;
}

function sameObservation(left, right) {
  return sameFileIdentity(left?.identity, right?.identity) && left?.content === right?.content;
}

async function readLockObservation(operations, lock) {
  try {
    const before = fileIdentity(await operations.stat(lock));
    const content = await operations.readFile(lock, 'utf8');
    const after = fileIdentity(await operations.stat(lock));
    if (!sameFileIdentity(before, after)) return undefined;
    return Object.freeze({ identity: after, content, metadata: parseLockMetadata(content) });
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

function processStartTicks(content) {
  const commandEnd = content.lastIndexOf(')');
  if (commandEnd < 0) return undefined;
  const fieldsAfterCommand = content.slice(commandEnd + 1).trim().split(/\s+/);
  const value = fieldsAfterCommand[19];
  return typeof value === 'string' && /^\d+$/.test(value) ? value : undefined;
}

async function defaultReadProcessIdentity(pid) {
  if (systemPlatform() !== 'linux') return Object.freeze({ alive: await defaultIsProcessAlive(pid) });
  let bootId;
  try {
    bootId = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  } catch (error) {
    return Object.freeze({ alive: await defaultIsProcessAlive(pid) });
  }
  try {
    const start = processStartTicks(await readFile(`/proc/${pid}/stat`, 'utf8'));
    if (!start) return Object.freeze({ alive: true, bootId });
    return Object.freeze({ alive: true, bootId, processStartTicks: start });
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({ alive: false, bootId });
    return Object.freeze({ alive: await defaultIsProcessAlive(pid), bootId });
  }
}

async function ownerIsDead(metadata, { owner, isProcessAlive, readProcessIdentity }) {
  if (!metadata || metadata.owner.hostname !== owner.hostname) return metadata === undefined;
  if (metadata.version === LEGACY_LOCK_VERSION) return await isProcessAlive(metadata.owner.pid) === false;
  const current = await readProcessIdentity(metadata.owner.pid);
  if (current?.bootId && metadata.owner.bootId && current.bootId !== metadata.owner.bootId) return true;
  if (current?.alive === false) return true;
  if (current?.processStartTicks && metadata.owner.processStartTicks
    && current.processStartTicks !== metadata.owner.processStartTicks) return true;
  return false;
}

async function removePrepared(operations, prepared) {
  try {
    await operations.rm(prepared, { force: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function publishPreparedLock({ operations, prepared, lock, retryDelay, maxTransientAttempts }) {
  await retryTransientSharing(() => operations.link(prepared, lock), { retryDelay, maxTransientAttempts });
  try {
    await removePrepared(operations, prepared);
    return await operations.open(lock, 'r');
  } catch (error) {
    error.lockOwnershipPublished = true;
    throw error;
  }
}

async function reclaimAndPublish({
  operations,
  prepared,
  lock,
  owner,
  observed,
  isProcessAlive,
  readProcessIdentity,
  retryDelay,
  maxTransientAttempts,
}) {
  if (!observed || !await ownerIsDead(observed.metadata, { owner, isProcessAlive, readProcessIdentity })) return undefined;
  const confirmed = await readLockObservation(operations, lock);
  if (!sameObservation(observed, confirmed)) return undefined;

  return withKeyedLock(lock, async () => {
    const current = await readLockObservation(operations, lock);
    if (!sameObservation(confirmed, current)) return undefined;
    if (!await ownerIsDead(current.metadata, { owner, isProcessAlive, readProcessIdentity })) return undefined;
    const quarantine = `${lock}.stale-${randomUUID()}`;
    try {
      await operations.rename(lock, quarantine);
    } catch (error) {
      if (error?.code === 'ENOENT') return undefined;
      throw error;
    }
    const quarantined = await readLockObservation(operations, quarantine);
    if (!sameObservation(current, quarantined)) {
      throw new Error('mission lock changed during stale-owner reclamation');
    }
    await operations.rm(quarantine, { force: true });
    try {
      return await publishPreparedLock({ operations, prepared, lock, retryDelay, maxTransientAttempts });
    } catch (error) {
      if (error?.code === 'EEXIST') return undefined;
      throw error;
    }
  });
}

function expectedCleanupError(operation, error) {
  return error?.code === 'ENOENT' || (operation === 'close' && error?.code === 'EBADF');
}

async function cleanupMissionWrite({ operations, temporary, lockHandle, lock, lockToken, ownershipPublished }) {
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
  if (temporary) await attempt('temporary', () => operations.rm(temporary, { force: true }));
  await attempt('close', async () => lockHandle?.close());
  await attempt('lock', async () => {
    if (!ownershipPublished) return;
    await withKeyedLock(lock, async () => {
      const observed = await readLockObservation(operations, lock);
      if (!observed) return;
      if (!observed.metadata || observed.metadata.owner.token !== lockToken) throw new Error('mission lock ownership changed');
      await operations.rm(lock, { force: true });
    });
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
  readProcessIdentity,
  leaseMs = DEFAULT_LEASE_MS,
} = {}) {
  const operations = requireFilesystem(filesystem);
  if (typeof retryDelay !== 'function') throw new TypeError('retryDelay must be a function');
  const attempts = requireAttempts(maxTransientAttempts);
  const owner = requireOwner({ hostname, pid });
  const lockClock = requireClock(clock);
  if (typeof tokenFactory !== 'function') throw new TypeError('tokenFactory must be a function');
  if (typeof isProcessAlive !== 'function') throw new TypeError('isProcessAlive must be a function');
  if (readProcessIdentity !== undefined && typeof readProcessIdentity !== 'function') throw new TypeError('readProcessIdentity must be a function');
  const processIdentityReader = readProcessIdentity
    ?? (isProcessAlive === defaultIsProcessAlive
      ? defaultReadProcessIdentity
      : async (ownerPid) => Object.freeze({ alive: await isProcessAlive(ownerPid) }));
  const lockLeaseMs = requireLeaseMs(leaseMs);

  async function load({ root, missionId }) {
    const { snapshot } = locations(root, missionId);
    return readSnapshot(snapshot, { readFileImpl: operations.readFile });
  }

  async function listIds({ root }) {
    if (typeof root !== 'string' || root.length === 0) throw new TypeError('root must be a path');
    let entries;
    try {
      entries = await operations.readdir(path.resolve(root, 'missions'), { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return Object.freeze([]);
      throw error;
    }
    const ids = [];
    for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
      const match = SNAPSHOT.exec(entry.name);
      if (!match) continue;
      if (typeof entry.isFile === 'function' && !entry.isFile()) continue;
      ids.push(match[1]);
    }
    return Object.freeze(ids);
  }

  async function save({ root, mission, expectedRevision }) {
    if (!mission || typeof mission !== 'object') throw new TypeError('mission is required');
    const { directory, snapshot, lock } = locations(root, mission.id);
    await operations.mkdir(directory, { recursive: true });
    const lockToken = requireToken(tokenFactory());
    const prepared = `${lock}.candidate-${randomUUID()}`;
    let lockHandle;
    let ownershipPublished = false;
    try {
      const metadata = await lockMetadata({
        owner,
        token: lockToken,
        clock: lockClock,
        leaseMs: lockLeaseMs,
        readProcessIdentity: processIdentityReader,
      });
      await operations.writeFile(prepared, `${JSON.stringify(metadata)}\n`, { encoding: 'utf8', flag: 'wx' });
      try {
        lockHandle = await publishPreparedLock({
          operations,
          prepared,
          lock,
          retryDelay,
          maxTransientAttempts: attempts,
        });
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        const observed = await readLockObservation(operations, lock);
        lockHandle = await reclaimAndPublish({
          operations,
          prepared,
          lock,
          owner,
          observed,
          isProcessAlive,
          readProcessIdentity: processIdentityReader,
          retryDelay,
          maxTransientAttempts: attempts,
        });
        if (!lockHandle) throw new Error('mission write already in progress');
      }
      ownershipPublished = true;
    } catch (error) {
      if (error?.lockOwnershipPublished) ownershipPublished = true;
      let preparedFailure;
      try {
        await removePrepared(operations, prepared);
      } catch (cleanupError) {
        preparedFailure = new Error('mission cleanup failed: prepared lock', { cause: cleanupError });
      }
      const cleanupFailure = await cleanupMissionWrite({
        operations,
        temporary: undefined,
        lockHandle,
        lock,
        lockToken,
        ownershipPublished,
      });
      const cleanupFailures = [error, preparedFailure, cleanupFailure].filter(Boolean);
      if (cleanupFailures.length > 1) throw new AggregateError(cleanupFailures, 'mission lock acquisition and cleanup failed');
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
    const cleanupFailure = await cleanupMissionWrite({
      operations,
      temporary,
      lockHandle,
      lock,
      lockToken,
      ownershipPublished,
    });
    if (writeFailure && cleanupFailure) {
      throw new AggregateError([writeFailure, cleanupFailure], 'mission write and cleanup failed');
    }
    if (writeFailure) throw writeFailure;
    if (cleanupFailure) throw cleanupFailure;
    return result;
  }

  const store = Object.freeze({ loadMission: load, saveMission: save, listMissionIds: listIds });
  BRANDED_MISSION_STORES.add(store);
  return store;
}

const defaultMissionStore = createMissionStore();

export async function listMissionIds({ root }) {
  return defaultMissionStore.listMissionIds({ root });
}

export { defaultMissionStore };