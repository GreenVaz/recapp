/**
 * Дати у фінансовому рушії — це рядки 'YYYY-MM-DD', а не об'єкти Date.
 *
 * Причина: Date завжди несе час і часовий пояс. «5 листопада» у Києві та
 * у UTC — різні моменти, і щойно користувач перетинає північ або летить
 * у інший пояс, платіж «з'їжджає» на добу. Календарний день не має часу,
 * тож і тип не повинен його мати.
 *
 * Усі обчислення всередині йдуть через UTC-опівніч — так арифметика діб
 * не ламається на переході на літній час.
 */

export type DateISO = string;

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateISO(value: unknown): value is DateISO {
  return typeof value === 'string' && ISO_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

export function assertDateISO(value: string): DateISO {
  if (!isDateISO(value)) throw new RangeError(`Некоректна дата: ${value}`);
  return value;
}

export interface DateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export function parts(iso: DateISO): DateParts {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  return { year, month, day };
}

export function fromParts(year: number, month: number, day: number): DateISO {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(year, 4)}-${p(month)}-${p(day)}`;
}

/** Кількість днів у місяці з урахуванням високосного року. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isLeapYear(year: number): boolean {
  return daysInMonth(year, 2) === 29;
}

function toUTC(iso: DateISO): number {
  const { year, month, day } = parts(iso);
  return Date.UTC(year, month - 1, day);
}

function fromUTC(ms: number): DateISO {
  const d = new Date(ms);
  return fromParts(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Сьогоднішня дата в локальному поясі користувача. */
export function today(now: Date = new Date()): DateISO {
  return fromParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function addDays(iso: DateISO, days: number): DateISO {
  return fromUTC(toUTC(iso) + days * 86_400_000);
}

export function addWeeks(iso: DateISO, weeks: number): DateISO {
  return addDays(iso, weeks * 7);
}

export type MonthEndPolicy = 'clamp' | 'skip';

/**
 * Додає місяці, зберігаючи «намір» вихідного числа.
 *
 * 31 січня + 1 місяць — це 28 (або 29) лютого при політиці clamp і
 * «цього місяця платежу немає» при skip. Важливо, що наступний крок
 * рахується знову від якоря, а не від обрізаної дати: інакше після
 * лютого серія назавжди з'їхала б на 28 число.
 */
export function addMonths(iso: DateISO, months: number, policy: MonthEndPolicy = 'clamp'): DateISO | null {
  const { year, month, day } = parts(iso);
  const total = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = (total % 12) + 1;
  const limit = daysInMonth(targetYear, targetMonth);

  if (day > limit) {
    if (policy === 'skip') return null;
    return fromParts(targetYear, targetMonth, limit);
  }
  return fromParts(targetYear, targetMonth, day);
}

export function addYears(iso: DateISO, years: number, policy: MonthEndPolicy = 'clamp'): DateISO | null {
  return addMonths(iso, years * 12, policy);
}

export function compare(a: DateISO, b: DateISO): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const isBefore = (a: DateISO, b: DateISO) => a < b;
export const isAfter = (a: DateISO, b: DateISO) => a > b;
export const isSameOrBefore = (a: DateISO, b: DateISO) => a <= b;
export const isSameOrAfter = (a: DateISO, b: DateISO) => a >= b;

export function min(a: DateISO, b: DateISO): DateISO {
  return a <= b ? a : b;
}

export function max(a: DateISO, b: DateISO): DateISO {
  return a >= b ? a : b;
}

export function diffDays(from: DateISO, to: DateISO): number {
  return Math.round((toUTC(to) - toUTC(from)) / 86_400_000);
}

export function startOfMonth(iso: DateISO): DateISO {
  const { year, month } = parts(iso);
  return fromParts(year, month, 1);
}

export function endOfMonth(iso: DateISO): DateISO {
  const { year, month } = parts(iso);
  return fromParts(year, month, daysInMonth(year, month));
}

export function monthKey(iso: DateISO): string {
  return iso.slice(0, 7);
}

export function startOfWeek(iso: DateISO, weekStartsOn = 1): DateISO {
  const dow = new Date(toUTC(iso)).getUTCDay();
  const shift = (dow - weekStartsOn + 7) % 7;
  return addDays(iso, -shift);
}

/** День тижня: 0 — неділя … 6 — субота. */
export function dayOfWeek(iso: DateISO): number {
  return new Date(toUTC(iso)).getUTCDay();
}

/** Перелік усіх дат включно. Порожній масив, якщо to < from. */
export function eachDay(from: DateISO, to: DateISO): DateISO[] {
  const out: DateISO[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Сітка місяця для календаря: завжди цілі тижні. */
export function monthGrid(iso: DateISO, weekStartsOn = 1): DateISO[] {
  const first = startOfWeek(startOfMonth(iso), weekStartsOn);
  const lastDay = endOfMonth(iso);
  const last = addDays(startOfWeek(lastDay, weekStartsOn), 6);
  return eachDay(first, last);
}
