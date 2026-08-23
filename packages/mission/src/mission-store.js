import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MISSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

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

async function readSnapshot(snapshot, { missing = false } = {}) {
  try {
    const parsed = JSON.parse(await readFile(snapshot, 'utf8'));
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
  const { snapshot } = locations(root, missionId);
  return readSnapshot(snapshot);
}

export async function saveMission({ root, mission, expectedRevision }) {
  if (!mission || typeof mission !== 'object') throw new TypeError('mission is required');
  const { directory, snapshot, lock } = locations(root, mission.id);
  await mkdir(directory, { recursive: true });

  let lockHandle;
  try {
    lockHandle = await open(lock, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('mission write already in progress');
    throw error;
  }

  const temporary = path.join(directory, `.${mission.id}.${randomUUID()}.tmp`);
  try {
    const current = await readSnapshot(snapshot, { missing: true });
    const currentRevision = current?.revision ?? 0;
    if (expectedRevision !== undefined && expectedRevision !== currentRevision) {
      throw new Error(`revision conflict: expected ${expectedRevision}, found ${currentRevision}`);
    }
    if (expectedRevision === undefined && currentRevision !== 0) {
      throw new Error(`revision conflict: mission already exists at revision ${currentRevision}`);
    }

    const record = { revision: currentRevision + 1, mission };
    await writeFile(temporary, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, snapshot);
    return record;
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
    await lockHandle.close().catch(() => {});
    await rm(lock, { force: true }).catch(() => {});
  }
}
