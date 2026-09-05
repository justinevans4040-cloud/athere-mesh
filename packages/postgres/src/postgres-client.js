import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

function isReconnectable(error) {
  const message = String(error?.message ?? error);
  return /not queryable|Connection terminated|connection.*closed|ECONNRESET|EPIPE|server closed the connection/i.test(message);
}

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

    let client = null;
    let lastClientError = null;
    let closed = false;

    async function openClient() {
      const next = new pg.Client({
        connectionString: databaseUrl,
        keepAlive: true,
        // Remote test wait is often 10–20s; probe before DERP/NAT idle kill.
        keepAliveInitialDelayMillis: 3_000,
      });
      // Without a listener, a mid-mission Tailscale blip becomes an uncaught
      // 'error' event and kills the owner process before evidence can be written.
      next.on('error', (error) => {
        lastClientError = error;
      });
      await next.connect();
      client = next;
      return next;
    }

    await openClient();

    return Object.freeze({
      query: async (text, values) => {
        if (closed) throw new Error('Postgres client is closed');
        try {
          return await client.query(text, values);
        } catch (error) {
          if (!isReconnectable(error)) throw error;
          try {
            await client.end().catch(() => {});
          } catch {
            // ignore teardown of a dead socket
          }
          await openClient();
          try {
            return await client.query(text, values);
          } catch (retryError) {
            if (lastClientError != null) retryError.cause = lastClientError;
            throw retryError;
          }
        }
      },
      close: async () => {
        closed = true;
        if (client != null) await client.end();
      },
    });
  }
  throw new Error('unknown Postgres mode');
}
