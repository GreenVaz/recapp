import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Conn, Database } from './types.ts';

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../db/migrations', import.meta.url));

/**
 * Ідемпотентний застосовувач міграцій.
 *
 * Викликається і з CLI (`npm run db:migrate`), і автоматично при першому
 * запиті до API — завдяки цьому розгортання не потребує окремого кроку:
 * щойно DATABASE_URL з'явився, схема створюється сама.
 *
 * Паралельні холодні старти безпечні: advisory-lock серіалізує їх, а
 * повторний запуск нічого не змінює.
 */

const LOCK_KEY = 4_172_553_001;

export async function runMigrations(db: Database, log: (m: string) => void = () => {}): Promise<string[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];

  await db.tx(async (c) => {
    await c.query(`select pg_advisory_xact_lock(${LOCK_KEY})`);
    await c.query(`
      create table if not exists _migrations (
        name       text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const done = new Set(
      (await c.query<{ name: string }>('select name from _migrations')).rows.map((r) => r.name),
    );

    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      log(`[migrate] applying ${file}`);
      await c.query(sql);
      await c.query('insert into _migrations (name) values ($1)', [file]);
      applied.push(file);
    }
  });

  return applied;
}

let migrationPromise: Promise<string[]> | undefined;

/** Запускає міграції щонайбільше один раз на процес. */
export function ensureMigrated(db: Database): Promise<string[]> {
  migrationPromise ??= runMigrations(db, (m) => console.log(m)).catch((e) => {
    // Скидаємо кеш, щоб наступний запит спробував знову, а не впав назавжди.
    migrationPromise = undefined;
    throw e;
  });
  return migrationPromise;
}

export async function resetMigrationState(): Promise<void> {
  migrationPromise = undefined;
}

export type { Conn };
