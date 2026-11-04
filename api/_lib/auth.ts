import { webcrypto as crypto } from 'node:crypto';
import { parseCookies, serializeCookie, unauthorized } from './http.ts';

/**
 * Автентифікація без зовнішніх залежностей: усе будується на Web Crypto,
 * який є і в Node, і в edge-середовищах.
 *
 * Паролі — PBKDF2-SHA256 з 210 000 ітерацій (рекомендація OWASP на 2024+).
 * Сесія — підписаний HS256 токен у httpOnly-cookie; поле `v` дублює
 * token_version користувача, тож зміна пароля миттєво анулює всі видані
 * токени на всіх пристроях.
 */

const COOKIE_NAME = 'pf_session';
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 210_000;

const encoder = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Buffer.from(view).toString('base64url');
}

function fromB64url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 16) {
    throw new Error(
      'AUTH_SECRET не заданий або закороткий. Згенеруйте: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    );
  }
  return encoder.encode(value);
}

// ─── Паролі ─────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(bits)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterationsRaw, saltRaw, hashRaw] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iterationsRaw || !saltRaw || !hashRaw) return false;

  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: fromB64url(saltRaw),
      iterations: Number(iterationsRaw),
      hash: 'SHA-256',
    },
    key,
    256,
  );
  return timingSafeEqual(b64url(bits), hashRaw);
}

/** Порівняння за сталий час — щоб не зливати інформацію таймінгом. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── Токени сесії ───────────────────────────────────────────────────────

interface TokenPayload {
  sub: string;
  v: number;
  exp: number;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', secret(), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function signToken(userId: string, tokenVersion: number): Promise<string> {
  const payload: TokenPayload = {
    sub: userId,
    v: tokenVersion,
    exp: Math.floor(Date.now() / 1000) + SESSION_DAYS * 86_400,
  };
  const body = b64url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(), encoder.encode(body));
  return `${body}.${b64url(signature)}`;
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(),
    fromB64url(signature),
    encoder.encode(body),
  );
  if (!valid) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
    if (!payload.sub || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string): string {
  return serializeCookie(COOKIE_NAME, token, { maxAge: SESSION_DAYS * 86_400 });
}

export function clearSessionCookie(): string {
  return serializeCookie(COOKIE_NAME, '', { maxAge: 0 });
}

export function readSessionToken(request: Request): string | null {
  return parseCookies(request)[COOKIE_NAME] ?? null;
}

export async function requireSession(request: Request): Promise<TokenPayload> {
  const token = readSessionToken(request);
  if (!token) throw unauthorized();
  const payload = await verifyToken(token);
  if (!payload) throw unauthorized('Сесія недійсна або прострочена');
  return payload;
}

// ─── Токени відновлення пароля ──────────────────────────────────────────

export function generateResetToken(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashResetToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return b64url(digest);
}
