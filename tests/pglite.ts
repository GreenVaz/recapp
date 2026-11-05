import { PGlite } from '@electric-sql/pglite';
import type { Conn, Database, QueryResult } from '../api/_lib/db/types.js';
import { runMigrations } from '../api/_lib/db/migrate.js';

/**
 * PostgreSQL у пам'яті для тестів.
 *
 * PGlite — це справжній PostgreSQL, скомпільований у WebAssembly, тож
 * міграції, NUMERIC, LATERAL і RLS поводяться так само, як у Neon.
 * Інтеграційні тести перевіряють реальний SQL без жодного зовнішнього сервера.
 */
export class PGliteDatabase implements Database {
  private depth = 0;

  constructor(private readonly pg: PGlite) {}

  static async create(): Promise<PGliteDatabase> {
    const pg = await PGlite.create();
    const db = new PGliteDatabase(pg);
    await runMigrations(db);
    return db;
  }

  private conn(): Conn {
    return {
      query: async <R>(text: string, params?: readonly unknown[]) => {
        // Extended-протокол (prepared statement) не приймає кілька команд в
        // одному рядку, а файли міграцій саме такі. Без параметрів ідемо
        // через exec(), який виконує скрипт цілком.
        if (!params || params.length === 0) {
          const results = await this.pg.exec(text);
          const last = results.at(-1);
          return { rows: (last?.rows ?? []) as R[], rowCount: last?.affectedRows ?? 0 };
        }
        const res = await this.pg.query(text, [...params]);
        return { rows: res.rows as R[], rowCount: res.affectedRows ?? res.rows.length };
      },
    };
  }

  async tx<T>(fn: (c: Conn) => Promise<T>): Promise<T> {
    // PGlite не підтримує вкладені транзакції — рівні глибше першого
    // виконуються в уже відкритій транзакції.
    if (this.depth > 0) return fn(this.conn());

    const c = this.conn();
    this.depth += 1;
    try {
      await c.query('begin');
      const result = await fn(c);
      await c.query('commit');
      return result;
    } catch (e) {
      await c.query('rollback').catch(() => undefined);
      throw e;
    } finally {
      this.depth -= 1;
    }
  }

  async close(): Promise<void> {
    await this.pg.close();
  }

  /** Повне очищення даних між тестами (схема лишається). */
  async truncateAll(): Promise<void> {
    await this.pg.exec(`
      set session_replication_role = replica;
      truncate table loan_payments, transactions, loan_payment_schedules, loans,
        recurring_exceptions, recurring_rules, categories, accounts,
        exchange_rates, user_settings, profiles, password_reset_tokens, users cascade;
      set session_replication_role = default;
    `);
  }
}

export type { QueryResult };
