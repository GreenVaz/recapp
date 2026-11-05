import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeHandler } from '../api/_lib/node-adapter.js';
import { setDb } from '../api/_lib/db/pg.js';

/**
 * Локальний сервер для `npm run dev` і для E2E-перевірок.
 *
 * Без DATABASE_URL піднімає PostgreSQL у пам'яті (PGlite) — це та сама
 * СУБД і ті самі міграції, тож застосунок можна запустити й перевірити
 * без жодного зовнішнього сервісу. У продакшні цей файл не виконується:
 * там API обслуговує Vercel-функція, яка завжди ходить у Neon.
 */

const port = Number(process.env.API_PORT ?? 8787);
const DIST = fileURLToPath(new URL('../dist', import.meta.url));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function useInMemoryDatabase(): Promise<void> {
  process.env.AUTH_SECRET ??= 'local-development-secret-change-me-please';

  const { PGlite } = await import('@electric-sql/pglite');
  const { runMigrations } = await import('../api/_lib/db/migrate.js');
  const pg = await PGlite.create();

  let depth = 0;
  const conn = {
    async query<R>(text: string, params?: readonly unknown[]) {
      if (!params || params.length === 0) {
        const results = await pg.exec(text);
        const last = results.at(-1);
        return { rows: (last?.rows ?? []) as R[], rowCount: last?.affectedRows ?? 0 };
      }
      const res = await pg.query(text, [...params]);
      return { rows: res.rows as R[], rowCount: res.affectedRows ?? res.rows.length };
    },
  };

  const db = {
    async tx<T>(fn: (c: typeof conn) => Promise<T>): Promise<T> {
      if (depth > 0) return fn(conn);
      depth += 1;
      try {
        await conn.query('begin');
        const result = await fn(conn);
        await conn.query('commit');
        return result;
      } catch (e) {
        await conn.query('rollback').catch(() => undefined);
        throw e;
      } finally {
        depth -= 1;
      }
    },
    async close() {
      await pg.close();
    },
  };

  await runMigrations(db);
  setDb(db);
  console.warn('⚠ DATABASE_URL не заданий — працюємо на PostgreSQL у пам\'яті. Дані зникнуть після зупинки.');
}

async function serveStatic(pathname: string): Promise<{ body: Buffer; type: string } | null> {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.join(DIST, relative);

  // Захист від виходу за межі dist через ../ у шляху.
  if (!target.startsWith(DIST)) return null;

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
    return { body: await readFile(target), type: MIME[path.extname(target)] ?? 'application/octet-stream' };
  } catch {
    return null;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) await useInMemoryDatabase();

  const hasDist = await stat(DIST).then(() => true).catch(() => false);

  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

    if (pathname.startsWith('/api/')) {
      void nodeHandler(req, res).catch((error) => {
        console.error('[dev-server]', error);
        if (!res.headersSent) res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Внутрішня помилка' }));
      });
      return;
    }

    if (!hasDist) {
      res.statusCode = 404;
      res.end('Статику обслуговує Vite на http://localhost:5173');
      return;
    }

    void (async () => {
      const file = (await serveStatic(pathname)) ?? (await serveStatic('/index.html'));
      if (!file) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      res.setHeader('content-type', file.type);
      res.end(file.body);
    })();
  });

  server.listen(port, () => {
    console.log(`API слухає http://localhost:${port}`);
    if (hasDist) console.log(`Зібраний застосунок: http://localhost:${port}`);
  });
}

void main();
