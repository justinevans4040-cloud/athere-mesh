import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export async function createPostgresClient({ mode, databaseUrl } = {}) {
  if (mode === 'embedded') {
    const db = new PGlite();
    return Object.freeze({
      query: (text, values) => db.query(text, values),
      close: () => db.close(),
    });
  }
  if (mode === 'live') {
    if (typeof databaseUrl !== 'string' || !/^postgres(?:ql)?:\/\//.test(databaseUrl)) {
      throw new Error('live Postgres mode requires DATABASE_URL');
    }
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    return Object.freeze({
      query: (text, values) => client.query(text, values),
      close: () => client.end(),
    });
  }
  throw new Error('unknown Postgres mode');
}
