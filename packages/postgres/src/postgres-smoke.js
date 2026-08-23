import { createMission, transitionMission } from '../../contracts/src/mission.js';
import { createPostgresMissionStore } from './postgres-mission-store.js';

export async function runPostgresSmoke({ client, missionId, at = new Date().toISOString() }) {
  const store = await createPostgresMissionStore({ db: client });
  const clock = () => at;
  const accepted = createMission({ id: missionId, intent: 'Prove Titan PostgreSQL durability', clock });
  const running = transitionMission(accepted, { type: 'running', agent: 'titan' }, { clock });
  const saved = await store.save({ mission: running });
  const loaded = await store.load({ missionId });
  const version = await client.query('SELECT version() AS version');
  return Object.freeze({
    ok: loaded.mission.id === missionId && loaded.mission.status === 'running',
    missionId,
    revision: saved.revision,
    status: loaded.mission.status,
    server: version.rows[0].version,
    at,
  });
}
