/**
 * Клієнт особистого API Monobank.
 *
 * Два обмеження банку, які визначають усю конструкцію синхронізації:
 *
 * - **один запит на 60 секунд** на кожен endpoint. Тому історія тягнеться
 *   не циклом, а по одному вікну за виклик, із журналом у `sync_windows`.
 * - **не більше 31 дня** за один запит виписки.
 *
 * Живі оновлення йдуть не опитуванням, а вебхуком: банк сам шле нову
 * операцію, щойно вона зʼявилась. Це єдиний спосіб мати миттєві оновлення
 * на безкоштовному тарифі, де фонових задач немає.
 */

import type {
  MonoClientInfo,
  MonoCurrencyRate,
  MonoStatementItem,
} from '../../src/core/monobank.js';

const BASE_URL = 'https://api.monobank.ua';
const TIMEOUT_MS = 20_000;

export type Fetcher = typeof fetch;

export class MonobankError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Скільки секунд чекати, якщо банк попросив пригальмувати. */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'MonobankError';
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isBadToken(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

async function call<T>(
  token: string,
  path: string,
  init: RequestInit = {},
  fetcher: Fetcher = fetch,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetcher(`${BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'X-Token': token, 'content-type': 'application/json', ...init.headers },
    });
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === 'AbortError';
    throw new MonobankError(
      aborted ? 'Банк не відповів вчасно' : 'Не вдалося звʼязатися з банком',
      0,
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.ok) return (await response.json()) as T;

  // Тіло помилки в банку — {errorDescription}, але не завжди.
  let detail = '';
  try {
    const body = (await response.json()) as { errorDescription?: string };
    detail = body?.errorDescription ?? '';
  } catch {
    detail = '';
  }

  if (response.status === 429) {
    const header = Number(response.headers.get('retry-after'));
    throw new MonobankError(
      'Банк дозволяє один запит на хвилину — зачекайте й спробуйте ще раз',
      429,
      Number.isFinite(header) && header > 0 ? header : 60,
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new MonobankError(detail || 'Токен не підійшов — перевірте його й підключіть заново', response.status);
  }
  throw new MonobankError(detail || `Банк відповів помилкою ${response.status}`, response.status);
}

/** Рахунки, банки й поточні залишки. Один запит на 60 секунд. */
export function fetchClientInfo(token: string, fetcher: Fetcher = fetch): Promise<MonoClientInfo> {
  return call<MonoClientInfo>(token, '/personal/client-info', {}, fetcher);
}

/**
 * Виписка за проміжок. Межі — unix-секунди, не довше 31 дня.
 * `accountId` 0 означає типовий гривневий рахунок.
 */
export function fetchStatement(
  token: string,
  accountId: string,
  fromUnix: number,
  toUnix: number,
  fetcher: Fetcher = fetch,
): Promise<MonoStatementItem[]> {
  return call<MonoStatementItem[]>(
    token,
    `/personal/statement/${encodeURIComponent(accountId)}/${fromUnix}/${toUnix}`,
    {},
    fetcher,
  );
}

/**
 * Реєструє адресу вебхука. Банк одразу шле на неї GET для перевірки й чекає
 * 200 — тому маршрут мусить відповідати ще до того, як ми щось про нього
 * запишемо в базу.
 */
export function setWebhook(token: string, url: string, fetcher: Fetcher = fetch): Promise<unknown> {
  return call(
    token,
    '/personal/webhook',
    { method: 'POST', body: JSON.stringify({ webHookUrl: url }) },
    fetcher,
  );
}

/** Порожня адреса відписує вебхук — так банк перестає слати оновлення. */
export function clearWebhook(token: string, fetcher: Fetcher = fetch): Promise<unknown> {
  return setWebhook(token, '', fetcher);
}

/**
 * Публічні курси банку. Токен не потрібен — і не надсилається.
 *
 * Банк оновлює їх не частіше ніж раз на 5 хвилин і на частіші запити
 * відповідає 429, тож викликати це має сенс лише з перевіркою давності.
 */
export async function fetchCurrencyRates(fetcher: Fetcher = fetch): Promise<MonoCurrencyRate[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetcher(`${BASE_URL}/bank/currency`, { signal: controller.signal });
  } catch {
    throw new MonobankError('Не вдалося отримати курси банку', 0);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429) {
    throw new MonobankError('Банк оновлює курси раз на 5 хвилин — спробуйте пізніше', 429, 300);
  }
  if (!response.ok) {
    throw new MonobankError(`Банк відповів помилкою ${response.status}`, response.status);
  }
  return (await response.json()) as MonoCurrencyRate[];
}
