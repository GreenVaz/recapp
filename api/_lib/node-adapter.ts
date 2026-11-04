import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from './router.ts';

/**
 * Міст між Node-подібним API (Vercel-функція, локальний node:http) і
 * вебстандартними Request/Response, якими користується роутер.
 *
 * Завдяки цьому мосту логіка маршрутів не знає ні про Vercel, ні про
 * node:http — і тестується звичайним `new Request(...)`.
 */

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;

  // Vercel уже міг розібрати тіло — тоді потоку більше немає.
  const parsed = (req as IncomingMessage & { body?: unknown }).body;
  if (parsed !== undefined && parsed !== null) {
    if (Buffer.isBuffer(parsed)) return parsed;
    if (typeof parsed === 'string') return Buffer.from(parsed);
    return Buffer.from(JSON.stringify(parsed));
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

export function toRequest(req: IncomingMessage, body: Buffer | undefined): Request {
  const host = req.headers.host ?? 'localhost';
  const protocol = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http';
  const url = new URL(req.url ?? '/', `${protocol}://${host}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else headers.set(key, value);
  }

  return new Request(url, {
    method: req.method ?? 'GET',
    headers,
    // Buffer не входить у BodyInit; Uint8Array — входить і не копіює дані.
    ...(body ? { body: new Uint8Array(body) } : {}),
  });
}

export async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  // Set-Cookie може бути кілька — звичайний entries() їх злив би в один рядок.
  const cookies = response.headers.getSetCookie?.() ?? [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'set-cookie') res.setHeader(key, value);
  });
  if (cookies.length > 0) res.setHeader('set-cookie', cookies);

  res.statusCode = response.status;

  if (response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    res.end(buffer);
  } else {
    res.end();
  }
}

export async function nodeHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req);
  const response = await handle(toRequest(req, body));
  await sendResponse(res, response);
}
