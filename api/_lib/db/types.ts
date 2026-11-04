/**
 * Абстракція доступу до БД.
 *
 * Та сама SQL-мова працює у трьох місцях:
 *   - продакшн: Neon PostgreSQL через `pg`;
 *   - локальна розробка: будь-який PostgreSQL через той самий `pg`;
 *   - тести: PGlite (PostgreSQL, скомпільований у WASM) — без зовнішнього
 *     сервера, але з тими самими міграціями, типами NUMERIC і RLS.
 *
 * Завдяки цьому інтеграційні тести перевіряють реальний SQL, а не мок.
 */

export interface QueryResult<R = Record<string, unknown>> {
  rows: R[];
  rowCount?: number | null;
}

export interface Conn {
  query<R = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<QueryResult<R>>;
}

export interface Database {
  /** Виконує fn усередині транзакції; при винятку — відкат. */
  tx<T>(fn: (c: Conn) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Виконує роботу в контексті користувача.
 *
 * set_config(..., true) — транзакційно-локальний, тож контекст не «протікає»
 * на наступний запит у пулі. Усі RLS-політики читають саме цю змінну, тому
 * запит без контексту не побачить жодного рядка.
 */
export async function asUser<T>(db: Database, userId: string, fn: (c: Conn) => Promise<T>): Promise<T> {
  return db.tx(async (c) => {
    // SET LOCAL ROLE обов'язковий: роль-власник у Neon має BYPASSRLS і
    // проігнорувала б політики. app_rls створена без цієї привілеї.
    await c.query('set local role app_rls');
    await c.query('select set_config($1, $2, true)', ['app.user_id', userId]);
    return fn(c);
  });
}

/** Контекст без користувача — лише для автентифікації (таблиця users без RLS). */
export async function asSystem<T>(db: Database, fn: (c: Conn) => Promise<T>): Promise<T> {
  return db.tx(fn);
}

export class DbError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
    this.name = 'DbError';
  }
}
