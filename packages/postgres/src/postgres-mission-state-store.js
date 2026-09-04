import { readFileSync } from 'node:fs';
import { createPostgresClient } from './postgres-client.js';
import { createPostgresMissionStore } from './postgres-mission-store.js';

function optional(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function requirePostgresUrl(value, label) {
  if (typeof value !== 'string' || !/^postgres(?:ql)?:\/\//.test(value)) {
    throw new Error(`${label} must be a postgres:// or postgresql:// URL`);
  }
  return value;
}

// Offline-first: returns null when shared Postgres is not configured, so the
// mission-state service keeps its filesystem default. Prefer
// ATHERE_MESH_POSTGRES_URL; DATABASE_URL remains accepted for older smoke paths.
export function resolveSharedMissionStoreOptions(env = process.env) {
  const meshUrl = optional(env.ATHERE_MESH_POSTGRES_URL);
  const legacyUrl = optional(env.DATABASE_URL);
  const passwordFile = optional(env.ATHERE_MESH_POSTGRES_PASSWORD_FILE);
  const passwordInline = optional(env.ATHERE_MESH_POSTGRES_PASSWORD);

  if (meshUrl === undefined && legacyUrl === undefined) {
    if (passwordFile !== undefined || passwordInline !== undefined) {
      throw new Error('ATHERE_MESH_POSTGRES_URL or DATABASE_URL is required whenever ATHERE_MESH_POSTGRES_PASSWORD or ATHERE_MESH_POSTGRES_PASSWORD_FILE is set');
    }
    return null;
  }

  let databaseUrl = requirePostgresUrl(meshUrl ?? legacyUrl, meshUrl !== undefined ? 'ATHERE_MESH_POSTGRES_URL' : 'DATABASE_URL');

  let password = passwordInline;
  if (passwordFile !== undefined) {
    try {
      password = readFileSync(passwordFile, 'utf8').trim();
    } catch (cause) {
      throw new Error(`ATHERE_MESH_POSTGRES_PASSWORD_FILE could not be read: ${passwordFile} (${cause.code ?? cause.message})`);
    }
  }

  if (password !== undefined) {
    const parsed = new URL(databaseUrl);
    if (!parsed.password) {
      parsed.password = password;
      databaseUrl = parsed.toString();
    }
  }

  return Object.freeze({
    mode: 'live',
    databaseUrl,
  });
}

// Bridges the existing Postgres snapshot adapter (load/save) onto the
// mission-state-service store contract (loadMission/saveMission). The service
// still requires a `root` argument for API stability and for sibling proof /
// artifact paths; the shared store ignores `root` for snapshot I/O.
export function adaptPostgresMissionStore(postgresStore) {
  if (!postgresStore || typeof postgresStore.load !== 'function' || typeof postgresStore.save !== 'function') {
    throw new TypeError('postgres store must provide load and save');
  }
  return Object.freeze({
    async loadMission({ missionId }) {
      return postgresStore.load({ missionId });
    },
    async listMissionIds() {
      if (typeof postgresStore.list !== 'function') {
        throw new TypeError('postgres store must provide list');
      }
      return postgresStore.list();
    },
    async saveMission({ mission, expectedRevision }) {
      return postgresStore.save({
        mission,
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
      });
    },
  });
}

export async function createPostgresMissionStateStore({ db }) {
  const postgresStore = await createPostgresMissionStore({ db });
  return adaptPostgresMissionStore(postgresStore);
}

// Opens the shared Postgres-backed mission store when configured. Returns null
// in the offline default so callers keep the filesystem adapter. The returned
// handle owns the live client; callers must close it.
export async function openSharedMissionStateStore(env = process.env) {
  const options = resolveSharedMissionStoreOptions(env);
  if (options === null) return null;
  const client = await createPostgresClient({ mode: 'live', databaseUrl: options.databaseUrl });
  try {
    const store = await createPostgresMissionStateStore({ db: client });
    return Object.freeze({
      store,
      client,
      databaseUrlHost: (() => {
        try {
          const parsed = new URL(options.databaseUrl);
          return `${parsed.hostname}:${parsed.port || '5432'}`;
        } catch {
          return '<unparsed>';
        }
      })(),
      async close() {
        await client.close();
      },
    });
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}
