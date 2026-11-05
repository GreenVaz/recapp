import { PGliteDatabase } from './pglite.js';
import { setDb } from '../api/_lib/db/pg.js';
import { handle } from '../api/_lib/router.js';

/**
 * Піднімає справжній API поверх PostgreSQL у пам'яті.
 *
 * Жодного мока: той самий роутер, ті самі міграції, та сама RLS.
 * Тести ходять у систему так само, як це робитиме браузер.
 */

process.env.AUTH_SECRET ??= 'test-secret-at-least-sixteen-characters-long';
process.env.NODE_ENV = 'test';

export interface ApiClient {
  request(method: string, path: string, body?: unknown): Promise<Response>;
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown): Promise<T>;
  put<T = unknown>(path: string, body?: unknown): Promise<T>;
  del(path: string): Promise<Response>;
  cookie: string | null;
}

export function createClient(): ApiClient {
  const client: ApiClient = {
    cookie: null,

    async request(method, path, body) {
      const headers: Record<string, string> = {};
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (client.cookie) headers.cookie = client.cookie;

      const response = await handle(
        new Request(`http://localhost${path}`, {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );

      const setCookie = response.headers.getSetCookie?.() ?? [];
      for (const raw of setCookie) {
        const pair = raw.split(';')[0]!;
        client.cookie = pair.endsWith('=') ? null : pair;
      }
      return response;
    },

    async get(path) {
      return unwrap(await client.request('GET', path));
    },
    async post(path, body) {
      return unwrap(await client.request('POST', path, body ?? {}));
    },
    async patch(path, body) {
      return unwrap(await client.request('PATCH', path, body ?? {}));
    },
    async put(path, body) {
      return unwrap(await client.request('PUT', path, body ?? {}));
    },
    async del(path) {
      return client.request('DELETE', path);
    },
  };

  return client;
}

async function unwrap(response: Response): Promise<never> {
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(data?.error ?? `HTTP ${response.status}`);
    Object.assign(error, { status: response.status, data });
    throw error;
  }
  return data as never;
}

let db: PGliteDatabase | undefined;

export async function startTestApi(): Promise<PGliteDatabase> {
  db = await PGliteDatabase.create();
  setDb(db);
  return db;
}

export async function stopTestApi(): Promise<void> {
  await db?.close();
  db = undefined;
}

/** Реєструє користувача і повертає готового до роботи клієнта. */
export async function signUp(email = `u${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.local`) {
  const client = createClient();
  const user = await client.post<{ id: string; email: string }>('/api/auth/register', {
    email,
    password: 'correct-horse-battery',
  });
  return { client, user };
}
