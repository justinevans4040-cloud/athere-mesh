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
