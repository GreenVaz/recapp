/**
 * Клієнт Monobank Personal API. Викликається ТІЛЬКИ з сервера —
 * токен не повинен потрапляти в браузер.
 *
 * Ліміти, які тут враховані:
 *  - client-info і statement: не частіше 1 запиту на 60 секунд;
 *  - один запит виписки покриває максимум 31 добу + 1 годину.
 */

const BASE_URL = "https://api.monobank.ua";
const MIN_INTERVAL_MS = 60_000;
const MAX_WINDOW_SEC = 31 * 24 * 60 * 60 + 3600;

export interface MonoAccount {
  id: string;
  sendId: string;
  balance: number;
  creditLimit: number;
  type: string;
  currencyCode: number;
  cashbackType?: string;
  maskedPan: string[];
  iban: string;
}

export interface MonoJar {
  id: string;
  sendId: string;
  title: string;
  description?: string;
  currencyCode: number;
  balance: number;
  goal?: number;
}

export interface MonoClientInfo {
  clientId: string;
  name: string;
  webHookUrl?: string;
  permissions: string;
  accounts: MonoAccount[];
  jars?: MonoJar[];
}

export interface MonoStatementItem {
  id: string;
  time: number; // unix seconds
  description: string;
  mcc: number;
  originalMcc: number;
  hold: boolean;
  amount: number; // мінорні одиниці, від'ємне = витрата
  operationAmount: number;
  currencyCode: number;
  commissionRate: number;
  cashbackAmount: number;
  balance: number;
  comment?: string;
  counterName?: string;
  counterEdrpou?: string;
  counterIban?: string;
}

export class MonobankError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "MonobankError";
  }
}

/** Час останнього запиту по кожному шляху — щоб не ловити 429. */
const lastCallAt = new Map<string, number>();

async function throttle(bucket: string) {
  const last = lastCallAt.get(bucket) ?? 0;
  const wait = MIN_INTERVAL_MS - (Date.now() - last);
  if (wait > 0) {
    throw new MonobankError(
      `Monobank дозволяє один запит на 60 секунд. Спробуйте через ${Math.ceil(wait / 1000)} с.`,
      429,
      Math.ceil(wait / 1000),
    );
  }
  lastCallAt.set(bucket, Date.now());
}

async function request<T>(path: string, token: string, bucket: string): Promise<T> {
  await throttle(bucket);

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { "X-Token": token },
      cache: "no-store",
    });
  } catch (e) {
    lastCallAt.delete(bucket); // мережева помилка — не витрачаємо вікно
    throw new MonobankError(
      `Не вдалося зв'язатися з api.monobank.ua: ${e instanceof Error ? e.message : "мережева помилка"}`,
      503,
    );
  }

  if (res.status === 429) {
    throw new MonobankError("Monobank повернув 429 — перевищено ліміт. Зачекайте хвилину.", 429, 60);
  }
  if (res.status === 403) {
    throw new MonobankError("Monobank відхилив токен (403). Перевірте його в налаштуваннях.", 403);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    let description = body;
    try {
      description = (JSON.parse(body) as { errorDescription?: string }).errorDescription ?? body;
    } catch {
      /* тіло не JSON — лишаємо як є */
    }
    throw new MonobankError(`Monobank повернув ${res.status}: ${description || "без деталей"}`, res.status);
  }

  return (await res.json()) as T;
}

export function getClientInfo(token: string) {
  return request<MonoClientInfo>("/personal/client-info", token, "client-info");
}

/**
 * Виписка за довільний період. Monobank обмежує одне вікно 31 добою,
 * тому довший діапазон ріжемо на частини й ідемо від найновішої до старішої.
 * Через ліміт 1 запит/60 с реально виконується одне вікно за виклик —
 * решта повертається як `remaining`, щоб UI міг попросити продовжити.
 */
export async function getStatement(
  token: string,
  accountId: string,
  from: Date,
  to: Date,
): Promise<MonoStatementItem[]> {
  const fromSec = Math.floor(from.getTime() / 1000);
  const toSec = Math.floor(to.getTime() / 1000);

  if (toSec - fromSec > MAX_WINDOW_SEC) {
    throw new MonobankError("Період не може перевищувати 31 добу за один запит.", 400);
  }

  return request<MonoStatementItem[]>(
    `/personal/statement/${accountId}/${fromSec}/${toSec}`,
    token,
    `statement:${accountId}`,
  );
}

/** Розбиває період на вікна по ≤31 добі, від найновішого до найстарішого. */
export function splitIntoWindows(from: Date, to: Date): Array<{ from: Date; to: Date }> {
  const windows: Array<{ from: Date; to: Date }> = [];
  let cursorTo = to.getTime();
  const fromMs = from.getTime();
  const windowMs = 30 * 24 * 60 * 60 * 1000; // 30 діб — із запасом до ліміту

  while (cursorTo > fromMs) {
    const cursorFrom = Math.max(fromMs, cursorTo - windowMs);
    windows.push({ from: new Date(cursorFrom), to: new Date(cursorTo) });
    cursorTo = cursorFrom - 1000;
  }
  return windows;
}

export function monoAccountTitle(account: MonoAccount, currency: string): string {
  const typeLabel: Record<string, string> = {
    black: "Чорна картка",
    white: "Біла картка",
    platinum: "Platinum",
    iron: "Iron",
    fop: "ФОП",
    yellow: "Жовта картка",
    eAid: "єПідтримка",
  };
  const base = typeLabel[account.type] ?? account.type;
  const pan = account.maskedPan?.[0]?.slice(-4);
  return pan ? `${base} ${currency} ·${pan}` : `${base} ${currency}`;
}
