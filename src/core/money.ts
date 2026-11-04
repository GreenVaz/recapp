/**
 * Гроші — цілі числа в мінорних одиницях (копійки, центи).
 *
 * Чому не float: 0.1 + 0.2 !== 0.3 у подвійній точності, і на сотнях
 * платежів похибка стає видимою в балансі. Чому не decimal-бібліотека:
 * цілочисельна арифметика точна за визначенням, швидша і не тягне
 * залежність; округлення потрібне лише там, де є множення на ставку,
 * і в цих місцях воно явне.
 *
 * У PostgreSQL ті самі величини лежать як NUMERIC(18,2) і приходять у
 * драйвер рядком — перетворення в обидва боки живе тут.
 */

export type Minor = number;

const SCALE = 100;

/** Округлення «половина від нуля» — так рахують банки, а не Math.round. */
export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** '15000.00' → 1500000. Приймає й те, що віддає NUMERIC. */
export function parseNumeric(value: string | number | null | undefined): Minor {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return roundHalfAwayFromZero(value * SCALE);

  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const digits = negative ? trimmed.slice(1) : trimmed;
  const [whole = '0', fraction = ''] = digits.split('.');

  // Беремо рівно два знаки, третій — для коректного округлення.
  const padded = (fraction + '000').slice(0, 3);
  const base = Number(whole) * SCALE + Number(padded.slice(0, 2));
  const carry = Number(padded[2]) >= 5 ? 1 : 0;
  const total = base + carry;

  return negative ? -total : total;
}

/** 1500000 → '15000.00' для запису в NUMERIC. */
export function toNumeric(minor: Minor): string {
  const negative = minor < 0;
  const abs = Math.abs(Math.trunc(minor));
  const whole = Math.floor(abs / SCALE);
  const cents = abs % SCALE;
  return `${negative ? '-' : ''}${whole}.${String(cents).padStart(2, '0')}`;
}

/** Людське число (149.5 або '149,50') → мінорні одиниці. */
export function fromMajor(value: number | string): Minor {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    return roundHalfAwayFromZero(value * SCALE);
  }
  return parseNumeric(value.replace(/\s/g, '').replace(',', '.'));
}

export function toMajor(minor: Minor): number {
  return minor / SCALE;
}

/**
 * Ділить суму на n частин без втрати жодної копійки.
 * Залишок розподіляється на перші частини, а не губиться в округленні.
 */
export function splitEvenly(total: Minor, parts: number): Minor[] {
  if (parts <= 0) return [];
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / parts);
  const remainder = abs - base * parts;
  return Array.from({ length: parts }, (_, i) => sign * (base + (i < remainder ? 1 : 0)));
}

/** Частка від суми з банківським округленням (для відсотків і комісій). */
export function percentOf(amount: Minor, percent: number): Minor {
  return roundHalfAwayFromZero((amount * percent) / 100);
}

export const CURRENCY_SYMBOL: Record<string, string> = {
  UAH: '₴',
  USD: '$',
  EUR: '€',
};

export const SUPPORTED_CURRENCIES = ['UAH', 'USD', 'EUR'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export interface FormatOptions {
  /** Показувати явний «+» для додатних значень. */
  sign?: boolean;
  /** 12 500 ₴ → 12,5 тис. ₴ */
  compact?: boolean;
  /** Приховати копійки, коли вони нульові. */
  trimCents?: boolean;
  locale?: string;
}

export function formatMoney(minor: Minor, currency = 'UAH', options: FormatOptions = {}): string {
  const { sign = false, compact = false, trimCents = false, locale = 'uk-UA' } = options;
  const symbol = CURRENCY_SYMBOL[currency] ?? currency;
  const value = toMajor(minor);
  const abs = Math.abs(value);

  let body: string;
  if (compact && abs >= 1000) {
    body = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(abs);
  } else {
    const noCents = trimCents && minor % SCALE === 0;
    body = new Intl.NumberFormat(locale, {
      minimumFractionDigits: noCents ? 0 : 2,
      maximumFractionDigits: noCents ? 0 : 2,
    }).format(abs);
  }

  const prefix = minor < 0 ? '−' : sign && minor > 0 ? '+' : '';
  return `${prefix}${body} ${symbol}`;
}

/** Курси: скільки одиниць базової валюти коштує 1 одиниця ключа. */
export type RateTable = Readonly<Record<string, number>>;

/**
 * Переводить суму в базову валюту.
 *
 * Якщо курсу немає, повертає null — свідомо, щоб викликач показав
 * «курс не задано», а не мовчки підсумував гривні з доларами як рівні.
 */
export function toBase(minor: Minor, currency: string, baseCurrency: string, rates: RateTable): Minor | null {
  if (currency === baseCurrency) return minor;
  const rate = rates[currency];
  if (!rate || !Number.isFinite(rate) || rate <= 0) return null;
  return roundHalfAwayFromZero(minor * rate);
}

/** Сума з позначкою, чи всі доданки вдалося перевести. */
export interface BaseSum {
  total: Minor;
  complete: boolean;
  missingCurrencies: string[];
}

export function sumInBase(
  items: ReadonlyArray<{ amount: Minor; currency: string }>,
  baseCurrency: string,
  rates: RateTable,
): BaseSum {
  let total = 0;
  const missing = new Set<string>();

  for (const item of items) {
    const converted = toBase(item.amount, item.currency, baseCurrency, rates);
    if (converted === null) missing.add(item.currency);
    else total += converted;
  }

  return { total, complete: missing.size === 0, missingCurrencies: [...missing] };
}
