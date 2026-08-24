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
      return record;
    } finally {
      await operations.rm(temporary, { force: true }).catch(() => {});
      await lockHandle.close().catch(() => {});
      await operations.rm(lock, { force: true }).catch(() => {});
    }
  }

  return Object.freeze({ loadMission: load, saveMission: save });
}

const defaultMissionStore = createMissionStore();
