/**
 * Перетворення даних Monobank у модель застосунку.
 *
 * Модуль навмисно чистий: ні мережі, ні бази, ні React. Усе, що тут є,
 * перевіряється юніт-тестами на зафіксованих відповідях API — саме тому
 * мапінг можна правити, не маючи доступу до банку.
 */

import type { DateISO } from './dates.js';
import { addDays, compare, diffDays, min as minDate } from './dates.js';
import type { Minor } from './money.js';

/** Часовий пояс, у якому банк веде операційний день. */
export const BANK_TIMEZONE = 'Europe/Kyiv';

/** Максимум, який Monobank віддає за один запит виписки. */
export const MAX_WINDOW_DAYS = 31;

/** Мінімальний проміжок між запитами до API, мілісекунди. */
export const RATE_LIMIT_MS = 60_000;

/** ISO 4217: числовий код у літерний. */
const CURRENCY_BY_CODE: Record<number, string> = {
  980: 'UAH',
  840: 'USD',
  978: 'EUR',
  826: 'GBP',
  985: 'PLN',
  756: 'CHF',
  203: 'CZK',
  348: 'HUF',
  124: 'CAD',
  392: 'JPY',
  949: 'TRY',
};

export function currencyFromCode(code: number): string | null {
  return CURRENCY_BY_CODE[code] ?? null;
}

// ─── Форма відповідей банку ────────────────────────────────────────────────

export interface MonoAccount {
  id: string;
  sendId?: string;
  balance: Minor;
  creditLimit: Minor;
  type: string;
  currencyCode: number;
  maskedPan?: string[];
  iban?: string;
}

export interface MonoJar {
  id: string;
  sendId?: string;
  title: string;
  description?: string;
  currencyCode: number;
  balance: Minor;
  goal?: Minor;
}

export interface MonoClientInfo {
  clientId: string;
  name: string;
  webHookUrl?: string;
  accounts: MonoAccount[];
  jars?: MonoJar[];
}

export interface MonoStatementItem {
  id: string;
  time: number;
  description: string;
  mcc: number;
  originalMcc?: number;
  hold: boolean;
  /** Сума у валюті рахунку, мінорні одиниці, зі знаком. */
  amount: Minor;
  /** Сума у валюті операції, мінорні одиниці, зі знаком. */
  operationAmount: Minor;
  /** Код валюти операції, не рахунку. */
  currencyCode: number;
  commissionRate?: Minor;
  cashbackAmount?: Minor;
  balance?: Minor;
  comment?: string;
  counterName?: string;
}

// ─── Назви рахунків ────────────────────────────────────────────────────────

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  black: 'Чорна',
  white: 'Біла',
  platinum: 'Платинум',
  iron: 'Залізна',
  yellow: 'Жовта',
  fop: 'ФОП',
  eAid: 'єПідтримка',
};

/**
 * Людська назва картки. Маска потрібна, бо карток одного типу буває кілька,
 * і без неї їх неможливо розрізнити в списку.
 */
export function accountTitle(account: MonoAccount): string {
  const currency = currencyFromCode(account.currencyCode) ?? '';
  const label = ACCOUNT_TYPE_LABEL[account.type] ?? account.type;
  const pan = account.maskedPan?.[0];
  const tail = pan ? ` ${pan.slice(-4)}` : '';
  return `${label}${tail}${currency && currency !== 'UAH' ? ` ${currency}` : ''}`.trim();
}

export function jarTitle(jar: MonoJar): string {
  return `Банка «${jar.title}»`;
}

// ─── Дати ──────────────────────────────────────────────────────────────────

const DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: BANK_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Unix-секунди в календарний день банку.
 *
 * Через UTC цього робити не можна: операція о 23:30 за Києвом припадає на
 * попередню добу в UTC, і платіж з'їжджає на день — рівно та пастка, про яку
 * попереджає AGENTS.md. Пояс задається явно.
 */
export function bankDay(unixSeconds: number): DateISO {
  return DAY_FORMATTER.format(new Date(unixSeconds * 1000));
}

/** Початок доби банку в unix-секундах — для меж запиту виписки. */
export function dayStartUnix(date: DateISO): number {
  return Math.floor(zonedMidnight(date) / 1000);
}

/** Кінець доби банку (остання секунда) в unix-секундах. */
export function dayEndUnix(date: DateISO): number {
  return Math.floor(zonedMidnight(addDays(date, 1)) / 1000) - 1;
}

/**
 * Опівніч указаної дати в поясі банку, у мілісекундах UTC.
 *
 * Зсув поясу змінюється (літній час), тому він обчислюється саме для цієї
 * дати, а не береться сталим.
 */
function zonedMidnight(date: DateISO): number {
  const naive = Date.parse(`${date}T00:00:00Z`);
  const offset = zoneOffsetMs(naive);
  // Друге наближення: якщо перше потрапило в іншу сторону переходу.
  return naive - zoneOffsetMs(naive - offset);
}

function zoneOffsetMs(utcMs: number): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: BANK_TIMEZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(utcMs))) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) === 24 ? 0 : Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - utcMs;
}

// ─── Планування довантаження ───────────────────────────────────────────────

export interface Window {
  from: DateISO;
  to: DateISO;
}

/**
 * Ділить діапазон на вікна, які банк погодиться віддати за один запит.
 *
 * Повертає від найсвіжішого до найдавнішого: користувач спершу бачить те,
 * що йому цікавіше, і може зупинитися, не чекаючи всієї історії.
 */
export function planWindows(from: DateISO, to: DateISO, maxDays = MAX_WINDOW_DAYS): Window[] {
  if (compare(from, to) > 0) return [];
  const span = Math.max(1, Math.floor(maxDays));

  const windows: Window[] = [];
  let cursor = from;
  while (compare(cursor, to) <= 0) {
    const end = minDate(addDays(cursor, span - 1), to);
    windows.push({ from: cursor, to: end });
    cursor = addDays(end, 1);
  }
  return windows.reverse();
}

/** Скільки запитів знадобиться — щоб чесно показати час очікування. */
export function estimateSyncMinutes(windowCount: number): number {
  return Math.max(0, windowCount - 1);
}

// ─── Операції ──────────────────────────────────────────────────────────────

export interface TransactionDraft {
  externalId: string;
  kind: 'income' | 'expense';
  /** Завжди додатна: напрям несе `kind`. */
  amount: Minor;
  currency: string;
  occurredOn: DateISO;
  note: string | null;
  mcc: number;
  hold: boolean;
}

/**
 * StatementItem у нашу операцію.
 *
 * Береться `amount` — сума у валюті рахунку. `operationAmount` і
 * `currencyCode` стосуються валюти операції й ідуть лише в коментар, інакше
 * покупка за 12 USD з гривневої картки записалася б як 12 грн.
 */
export function toTransactionDraft(
  item: MonoStatementItem,
  accountCurrency: string,
): TransactionDraft {
  const operationCurrency = currencyFromCode(item.currencyCode);
  const differs = operationCurrency !== null && operationCurrency !== accountCurrency;

  const pieces = [item.description?.trim(), item.comment?.trim()].filter(
    (x): x is string => Boolean(x),
  );
  if (differs) {
    pieces.push(`${(Math.abs(item.operationAmount) / 100).toFixed(2)} ${operationCurrency}`);
  }

  return {
    externalId: `mono:${item.id}`,
    kind: item.amount < 0 ? 'expense' : 'income',
    amount: Math.abs(item.amount),
    currency: accountCurrency,
    occurredOn: bankDay(item.time),
    note: pieces.length > 0 ? pieces.join(' · ') : null,
    mcc: item.mcc,
    hold: item.hold,
  };
}

/**
 * Початковий залишок рахунку, за якого поточний баланс зійдеться.
 *
 * Баланс у застосунку — похідна від історії, а банк віддає вже готове
 * число. Щоб вони збіглися, різницю кладемо в `initial_balance`.
 */
export function initialBalanceFor(currentBalance: Minor, importedDelta: Minor): Minor {
  return currentBalance - importedDelta;
}

/** Знакова сума чернетки — для підрахунку `importedDelta`. */
export function signedAmount(draft: TransactionDraft): Minor {
  return draft.kind === 'expense' ? -draft.amount : draft.amount;
}

/** Скільки днів історії покриває діапазон — для показу в інтерфейсі. */
export function spanDays(from: DateISO, to: DateISO): number {
  return diffDays(from, to) + 1;
}

// ─── Курси валют ───────────────────────────────────────────────────────────

/** Відповідь публічного endpoint /bank/currency — токен для нього не потрібен. */
export interface MonoCurrencyRate {
  currencyCodeA: number;
  currencyCodeB: number;
  date: number;
  rateSell?: number;
  rateBuy?: number;
  rateCross?: number;
}

/** Банк оновлює курси не частіше ніж раз на 5 хвилин. */
export const RATES_TTL_MS = 5 * 60_000;

/**
 * Один курс із запису банку.
 *
 * Береться середина між купівлею і продажем. Крайні значення спокусливі,
 * але обидва викривляють підсумок: за курсом продажу залишок у валюті
 * виглядає більшим, ніж за нього дадуть, за курсом купівлі — меншим, ніж
 * коштує. Для оцінки капіталу чесна саме середина.
 *
 * Для валют без обміну банк дає лише `rateCross` — тоді він.
 */
export function midRate(entry: MonoCurrencyRate): number | null {
  if (typeof entry.rateBuy === 'number' && typeof entry.rateSell === 'number') {
    const mid = (entry.rateBuy + entry.rateSell) / 2;
    return mid > 0 ? mid : null;
  }
  if (typeof entry.rateCross === 'number' && entry.rateCross > 0) return entry.rateCross;
  return null;
}

export interface RateRow {
  base: string;
  quote: string;
  rate: number;
}

/**
 * Витягає з відповіді банку ті пари, які застосунок уміє показувати.
 *
 * Усе інше ігнорується свідомо: курс валюти, якої немає в рахунках,
 * нікуди не підставиш, а зайві рядки лише засмічують налаштування.
 */
export function ratesFromMono(
  entries: readonly MonoCurrencyRate[],
  wanted: readonly string[] = ['USD', 'EUR'],
  quote = 'UAH',
): RateRow[] {
  const quoteCode = Object.entries(CURRENCY_BY_CODE).find(([, code]) => code === quote)?.[0];
  if (!quoteCode) return [];

  const rows: RateRow[] = [];
  for (const entry of entries) {
    if (String(entry.currencyCodeB) !== quoteCode) continue;

    const base = currencyFromCode(entry.currencyCodeA);
    if (!base || !wanted.includes(base)) continue;

    const rate = midRate(entry);
    if (rate === null) continue;

    rows.push({ base, quote, rate: Math.round(rate * 1e6) / 1e6 });
  }
  return rows;
}
