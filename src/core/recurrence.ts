import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  type DateISO,
  isSameOrAfter,
  isSameOrBefore,
} from './dates.ts';
import type { Minor } from './money.ts';
import type { RecurringException, RecurringRule } from './types.ts';

/**
 * Розгортання регулярних правил у конкретні дати.
 *
 * Кожне повторення рахується ВІД ЯКОРЯ (anchor + n кроків), а не від
 * попередньої дати. Це принципово: якщо «кожного 31 числа» обрізати
 * лютим і далі крокувати від 28-го, серія назавжди з'їде на 28 число.
 * Рахунок від якоря дає 31 січня → 28 лютого → 31 березня, як і очікує
 * будь-який банк.
 */

export interface Occurrence {
  ruleId: string;
  /** Дата серії — ідентифікує повторення навіть після перенесення. */
  occurrenceDate: DateISO;
  /** Фактична дата після застосування винятку 'move'. */
  date: DateISO;
  amount: Minor;
  note: string | null;
  moved: boolean;
  overridden: boolean;
}

/** Межа, за якою зупиняємо генерацію навіть без end_date. */
const HARD_LIMIT = 2000;

function nthDate(rule: RecurringRule, n: number): DateISO | null {
  const step = rule.step * n;
  switch (rule.freq) {
    case 'daily':
      return addDays(rule.anchorDate, step);
    case 'weekly':
      return addWeeks(rule.anchorDate, step);
    case 'monthly':
      return addMonths(rule.anchorDate, step, rule.monthEndPolicy);
    case 'yearly':
      return addYears(rule.anchorDate, step, rule.monthEndPolicy);
  }
}

/**
 * Усі повторення правила, що потрапляють у [from, to].
 *
 * Винятки застосовуються за датою серії, тому перенесене повторення
 * лишається тим самим повторенням і не задвоюється.
 */
export function expandRule(
  rule: RecurringRule,
  from: DateISO,
  to: DateISO,
  exceptions: readonly RecurringException[] = [],
): Occurrence[] {
  if (!rule.isActive) return [];

  const byDate = new Map(
    exceptions.filter((e) => e.ruleId === rule.id).map((e) => [e.occurrenceDate, e]),
  );

  const out: Occurrence[] = [];
  const hardEnd = rule.endDate && rule.endDate < to ? rule.endDate : to;

  for (let n = 0; n < HARD_LIMIT; n++) {
    if (rule.maxOccurrences !== null && n >= rule.maxOccurrences) break;

    const occurrenceDate = nthDate(rule, n);
    // null означає «цього періоду немає» за політикою skip — крокуємо далі.
    if (occurrenceDate === null) continue;

    if (rule.endDate && occurrenceDate > rule.endDate) break;
    // Перенесення може зсунути подію назад у вікно, тож запас у 62 дні.
    if (occurrenceDate > addDays(hardEnd, 62)) break;

    const exception = byDate.get(occurrenceDate);
    if (exception?.action === 'skip') continue;

    const date = exception?.action === 'move' && exception.newDate ? exception.newDate : occurrenceDate;
    if (!isSameOrAfter(date, from) || !isSameOrBefore(date, to)) continue;

    out.push({
      ruleId: rule.id,
      occurrenceDate,
      date,
      amount: exception?.newAmount ?? rule.amount,
      note: exception?.newNote ?? rule.note,
      moved: date !== occurrenceDate,
      overridden: exception?.action === 'override',
    });
  }

  return out;
}

export function expandRules(
  rules: readonly RecurringRule[],
  from: DateISO,
  to: DateISO,
  exceptions: readonly RecurringException[] = [],
): Occurrence[] {
  return rules
    .flatMap((rule) => expandRule(rule, from, to, exceptions))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Наступне повторення після заданої дати — для «найближчих платежів».
 * Шукає у вікні двох років, цього досить для будь-якої періодичності.
 */
export function nextOccurrence(
  rule: RecurringRule,
  after: DateISO,
  exceptions: readonly RecurringException[] = [],
): Occurrence | null {
  const horizon = addYears(after, 2, 'clamp') ?? addDays(after, 730);
  const all = expandRule(rule, addDays(after, 1), horizon, exceptions);
  return all[0] ?? null;
}

/** Ключ матеріалізації: по ньому транзакція пов'язується зі своїм повторенням. */
export function occurrenceKey(ruleId: string, occurrenceDate: DateISO): string {
  return `${ruleId}|${occurrenceDate}`;
}
