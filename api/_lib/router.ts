import type { Database } from './db/types.js';
import { getDb } from './db/pg.js';
import { ensureMigrated } from './db/migrate.js';
import { badRequest, notFound, toErrorResponse } from './http.js';
import { requireSession } from './auth.js';

/** Мінімальний роутер поверх вебстандартних Request/Response. */

export interface Ctx {
  request: Request;
  url: URL;
  params: Record<string, string>;
  db: Database;
}

export interface AuthedCtx extends Ctx {
  userId: string;
  tokenVersion: number;
}

/** Обов'язковий параметр шляху. Роутер уже гарантує його наявність —
 *  helper потрібен лише щоб типи це відображали. */
export function pathParam(params: Record<string, string>, name: string): string {
  const value = params[name];
  if (!value) throw badRequest(`У шляху бракує параметра ${name}`);
  return value;
}

export type Handler = (ctx: Ctx) => Promise<Response>;
export type AuthedHandler = (ctx: AuthedCtx) => Promise<Response>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  auth: boolean;
}

const routes: Route[] = [];

function add(method: string, pattern: string, handler: Handler, auth: boolean): void {
  routes.push({ method, segments: pattern.split('/').filter(Boolean), handler, auth });
}

/** Публічний маршрут — без сесії. */
export const open = (method: string, pattern: string, handler: Handler): void =>
  add(method, pattern, handler, false);

/** Захищений маршрут — ctx уже містить userId. */
export const guarded = (method: string, pattern: string, handler: AuthedHandler): void =>
  add(method, pattern, handler as Handler, true);

function match(route: Route, method: string, segments: string[]): Record<string, string> | null {
  if (route.method !== method) return null;
  if (route.segments.length !== segments.length) return null;

  const params: Record<string, string> = {};
  for (const [i, expected] of route.segments.entries()) {
    const actual = segments[i]!;
    if (expected.startsWith(':')) params[expected.slice(1)] = actual;
    else if (expected !== actual) return null;
  }
  return params;
}

let routesLoaded = false;

async function loadRoutes(): Promise<void> {
  if (routesLoaded) return;
  routesLoaded = true;
  // Реєстрація маршрутів — побічний ефект імпорту модулів.
  await Promise.all([
    import('./routes/auth.js'),
    import('./routes/accounts.js'),
    import('./routes/categories.js'),
    import('./routes/transactions.js'),
    import('./routes/recurring.js'),
    import('./routes/loans.js'),
    import('./routes/settings.js'),
    import('./routes/data.js'),
    import('./routes/import.js'),
  ]);
}

export async function handle(request: Request): Promise<Response> {
  try {
    await loadRoutes();

    const db = getDb();
    // Міграції виконуються один раз на процес — розгортання не потребує
    // окремого кроку, схема з'являється сама при першому запиті.
    await ensureMigrated(db);

    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);

    for (const route of routes) {
      const params = match(route, request.method, segments);
      if (!params) continue;

      const ctx: Ctx = { request, url, params, db };
      if (!route.auth) return await route.handler(ctx);

      const session = await requireSession(request);
      const authed: AuthedCtx = { ...ctx, userId: session.sub, tokenVersion: session.v };
      return await route.handler(authed);
    }

    throw notFound(`Маршрут ${request.method} ${url.pathname} не існує`);
  } catch (error) {
    return toErrorResponse(error);
  }
}
