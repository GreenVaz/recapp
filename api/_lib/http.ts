import { ZodError } from 'zod';

/**
 * HTTP-шар побудований на вебстандартних Request/Response.
 *
 * Завдяки цьому той самий роутер працює і як Vercel-функція, і в
 * локальному node:http сервері, і в тестах — туди просто передається
 * `new Request(...)`, без жодного мока.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (m: string, d?: unknown) => new HttpError(400, m, d);
export const unauthorized = (m = 'Потрібна авторизація') => new HttpError(401, m);
export const forbidden = (m = 'Немає доступу') => new HttpError(403, m);
export const notFound = (m = 'Не знайдено') => new HttpError(404, m);
export const conflict = (m: string, d?: unknown) => new HttpError(409, m, d);

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...JSON_HEADERS, ...init.headers },
  });
}

export function noContent(headers: HeadersInit = {}): Response {
  return new Response(null, { status: 204, headers });
}

/** Перетворює будь-який виняток на акуратну JSON-відповідь. */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof ZodError) {
    const issues = error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return json({ error: issues[0]?.message ?? 'Некоректні дані', issues }, { status: 422 });
  }

  if (error instanceof HttpError) {
    return json({ error: error.message, details: error.details }, { status: error.status });
  }

  const message = error instanceof Error ? error.message : 'Внутрішня помилка';

  // Порушення унікальних індексів — це не «щось зламалось», а конкретні
  // бізнес-правила схеми. Перекладаємо їх у зрозумілий текст.
  if (/duplicate key|unique constraint/i.test(message)) {
    if (message.includes('transactions_recurrence_unique')) {
      return json({ error: 'Це повторення вже додано як операцію' }, { status: 409 });
    }
    if (message.includes('loan_payments_schedule_unique')) {
      return json({ error: 'Цей платіж уже позначено виконаним' }, { status: 409 });
    }
    if (message.includes('loan_payments_transaction_unique')) {
      return json({ error: 'До цієї операції вже прив’язано платіж' }, { status: 409 });
    }
    if (message.includes('users_email_key')) {
      return json({ error: 'Користувач із такою поштою вже існує' }, { status: 409 });
    }
    return json({ error: 'Такий запис уже існує' }, { status: 409 });
  }

  console.error('[api]', error);
  return json({ error: message }, { status: 500 });
}

export async function readJson<T>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw badRequest('Тіло запиту не є коректним JSON');
  }
}

// ─── Cookies ────────────────────────────────────────────────────────────

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get('cookie');
  if (!header) return {};

  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export interface CookieOptions {
  maxAge?: number;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const {
    maxAge,
    path = '/',
    // Локально http://localhost — Secure зламав би розробку.
    secure = process.env.NODE_ENV === 'production',
    httpOnly = true,
    sameSite = 'Lax',
  } = options;

  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
