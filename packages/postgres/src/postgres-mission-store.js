const MISSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function requireMissionId(missionId) {
  if (typeof missionId !== 'string' || !MISSION_ID.test(missionId)) throw new Error('invalid mission id');
  return missionId;
}

export async function createPostgresMissionStore({ db }) {
  if (!db || typeof db.query !== 'function') throw new TypeError('Postgres query client is required');
  await db.query(`
    CREATE TABLE IF NOT EXISTS titan_missions (
      mission_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL CHECK (revision > 0),
      mission JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS titan_current_job_pointer (
      slot TEXT PRIMARY KEY CHECK (slot = 'current'),
      revision INTEGER NOT NULL CHECK (revision > 0),
      pointer JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  return Object.freeze({
    async load({ missionId }) {
      const id = requireMissionId(missionId);
      const result = await db.query(
        'SELECT revision, mission FROM titan_missions WHERE mission_id = $1',
        [id],
      );
      if (result.rows.length === 0) throw new Error('mission snapshot not found');
      const row = result.rows[0];
      return { revision: row.revision, mission: typeof row.mission === 'string' ? JSON.parse(row.mission) : row.mission };
    },

    async list() {
      const result = await db.query(
        'SELECT mission_id FROM titan_missions ORDER BY mission_id ASC',
      );
      return Object.freeze(result.rows.map((row) => row.mission_id));
    },

    async loadPointer() {
      const result = await db.query(
        `SELECT revision, pointer FROM titan_current_job_pointer WHERE slot = 'current'`,
      );
      if (result.rows.length === 0) return undefined;
      const row = result.rows[0];
      const pointer = typeof row.pointer === 'string' ? JSON.parse(row.pointer) : row.pointer;
      return Object.freeze({ revision: row.revision, pointer });
    },

    async savePointer({ pointer, expectedRevision }) {
      if (!pointer || typeof pointer !== 'object') throw new TypeError('current-job pointer is required');
      const payload = JSON.stringify(pointer);
      let result;
      if (expectedRevision === undefined || expectedRevision === 0) {
        result = await db.query(
          `INSERT INTO titan_current_job_pointer (slot, revision, pointer)
           VALUES ('current', 1, $1::jsonb)
           ON CONFLICT (slot) DO NOTHING
           RETURNING revision, pointer`,
          [payload],
        );
      } else {
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('invalid expected revision');
        result = await db.query(
          `UPDATE titan_current_job_pointer
           SET revision = revision + 1, pointer = $1::jsonb, updated_at = CURRENT_TIMESTAMP
           WHERE slot = 'current' AND revision = $2
           RETURNING revision, pointer`,
          [payload, expectedRevision],
        );
      }
      if (result.rows.length === 0) throw new Error('revision conflict');
      const row = result.rows[0];
      const stored = typeof row.pointer === 'string' ? JSON.parse(row.pointer) : row.pointer;
      return Object.freeze({ revision: row.revision, pointer: stored });
    },

    async save({ mission, expectedRevision }) {
      if (!mission || typeof mission !== 'object') throw new TypeError('mission is required');
      const id = requireMissionId(mission.id);
      let result;
      if (expectedRevision === undefined) {
        result = await db.query(
          `INSERT INTO titan_missions (mission_id, revision, mission)
           VALUES ($1, 1, $2::jsonb)
           ON CONFLICT (mission_id) DO NOTHING
           RETURNING revision`,
          [id, JSON.stringify(mission)],
        );
      } else {
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('invalid expected revision');
        result = await db.query(
          `UPDATE titan_missions
           SET revision = revision + 1, mission = $2::jsonb, updated_at = CURRENT_TIMESTAMP
           WHERE mission_id = $1 AND revision = $3
           RETURNING revision`,
          [id, JSON.stringify(mission), expectedRevision],
        );
      }
      if (result.rows.length === 0) throw new Error('revision conflict');
      return { revision: result.rows[0].revision, mission };
    },
  });
}
