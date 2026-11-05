import pg from 'pg';
import type { Conn, Database, QueryResult } from './types.js';

/**
 * PostgreSQL через node-postgres. Працює і з Neon, і з локальним Postgres.
 *
 * NUMERIC повертається драйвером як рядок — це навмисно: перетворення на
 * JS number втратило б точність. Розбір у мінорні одиниці робить шар money.
 */

// Вимикаємо автоматичне перетворення NUMERIC/int8 у number.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => v);
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => v);
// DATE повертаємо рядком YYYY-MM-DD, без зсуву часового поясу.
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

let pool: pg.Pool | undefined;

function getPool(): pg.Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL не заданий. Додайте Neon у Vercel → Storage, або впишіть рядок підключення в .env',
    );
  }

  pool = new pg.Pool({
    connectionString,
    // Serverless: коротке життя з'єднання, щоб не тримати слоти Neon.
    max: Number(process.env.PG_POOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    ssl: connectionString.includes('localhost') ? undefined : { rejectUnauthorized: true },
  });

  pool.on('error', (err) => console.error('[pg] idle client error', err));
  return pool;
}

export class PgDatabase implements Database {
  async tx<T>(fn: (c: Conn) => Promise<T>): Promise<T> {
    const client = await getPool().connect();
    try {
      await client.query('begin');
      const result = await fn({
        query: <R>(text: string, params?: readonly unknown[]) =>
          client.query(text, params as unknown[]) as unknown as Promise<QueryResult<R>>,
      });
      await client.query('commit');
      return result;
    } catch (e) {
      await client.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await pool?.end();
    pool = undefined;
  }
}

let instance: Database | undefined;

export function getDb(): Database {
  instance ??= new PgDatabase();
  return instance;
}

/** Тести підставляють власну реалізацію (PGlite). */
export function setDb(db: Database): void {
  instance = db;
}
