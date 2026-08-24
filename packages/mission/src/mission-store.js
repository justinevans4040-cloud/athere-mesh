import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const MISSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const TRANSIENT_SHARING_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);
const DEFAULT_FILESYSTEM = Object.freeze({ mkdir, open, readFile, rename, rm, writeFile });

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

function expectedCleanupError(operation, error) {
  return error?.code === 'ENOENT' || (operation === 'close' && error?.code === 'EBADF');
}

async function cleanupMissionWrite({ operations, temporary, lockHandle, lock }) {
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
  await attempt('lock', () => operations.rm(lock, { force: true }));
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
} = {}) {
  const operations = requireFilesystem(filesystem);
  if (typeof retryDelay !== 'function') throw new TypeError('retryDelay must be a function');
  const attempts = requireAttempts(maxTransientAttempts);

  async function load({ root, missionId }) {
    const { snapshot } = locations(root, missionId);
    return readSnapshot(snapshot, { readFileImpl: operations.readFile });
  }

  async function save({ root, mission, expectedRevision }) {
    if (!mission || typeof mission !== 'object') throw new TypeError('mission is required');
    const { directory, snapshot, lock } = locations(root, mission.id);
    await operations.mkdir(directory, { recursive: true });

    let lockHandle;
    try {
      lockHandle = await retryTransientSharing(() => operations.open(lock, 'wx'), { retryDelay, maxTransientAttempts: attempts });
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('mission write already in progress');
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
    const cleanupFailure = await cleanupMissionWrite({ operations, temporary, lockHandle, lock });
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
