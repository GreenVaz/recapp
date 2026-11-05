import { addDays, type DateISO, eachDay, max as maxDate, min as minDate } from './dates.js';
import { type Minor, type RateTable, toBase } from './money.js';
import { expandRules, occurrenceKey } from './recurrence.js';
import type { RecurringException, RecurringRule, ScheduleRow, Transaction } from './types.js';

/**
 * Прогноз щоденного залишку.
 *
 * Це єдине місце в застосунку, де баланс перетворюється на часовий ряд:
 * календар, головний екран і аналітика читають один і той самий результат,
 * тож «скільки буде грошей 15 числа» не може відрізнятися між екранами.
 *
 * Модель розділяє два ряди:
 *
 *   fact      — для минулих днів. Відмотується назад від поточного балансу
 *               відніманням проведених операцій. Прострочені, але не
 *               виконані платежі сюди НЕ входять: грошей з рахунку вони
 *               не зняли.
 *
 *   projection — для сьогодні й майбутнього. Стартує з фактичного балансу
 *               і додає лише те, що ще не виконано. Платіж, уже проведений
 *               транзакцією, не додається вдруге — саме так виконується
 *               вимога «борговий платіж не віднімати двічі».
 */

export type EventSource = 'transaction' | 'recurring' | 'loan' | 'scenario';
export type EventKind = 'income' | 'expense' | 'transfer' | 'adjustment' | 'loan_payment';

export interface ForecastEvent {
  key: string;
  source: EventSource;
  kind: EventKind;
  date: DateISO;
  /** Вплив на капітал у базовій валюті, зі знаком. */
  delta: Minor;
  amount: Minor;
  currency: string;
  accountId: string;
  counterAccountId: string | null;
  categoryId: string | null;
  title: string;
  /** true — гроші вже зійшли з рахунку. */
  isActual: boolean;
  /** Невиконана подія з датою в минулому. */
  isOverdue: boolean;
  refId: string;
  loanId?: string;
  ruleId?: string;
  occurrenceDate?: DateISO;
  /** Валюту не вдалося перевести в базову — сума не врахована в підсумках. */
  unconverted: boolean;
}

export interface ForecastDay {
  date: DateISO;
  isPast: boolean;
  isToday: boolean;
  opening: Minor;
  closing: Minor;
  income: Minor;
  expense: Minor;
  loanPayments: Minor;
  /** Доходи мінус витрати й кредитні платежі за цей день. */
  net: Minor;
  events: ForecastEvent[];
  hasDeficit: boolean;
}

export interface AccountSnapshot {
  id: string;
  currency: string;
  /** Поточний баланс із БД — уже містить усі проведені операції. */
  balance: Minor;
}

export interface LoanDue extends Pick<ScheduleRow, 'dueOn' | 'amount' | 'status'> {
  id: string;
  loanId: string;
  loanName: string;
  currency: string;
  accountId: string | null;
  categoryId: string | null;
}

export interface ScenarioEvent {
  date: DateISO;
  amount: Minor;
  currency: string;
  kind: 'income' | 'expense';
  title: string;
  accountId?: string | null;
}

export interface ForecastInput {
  from: DateISO;
  to: DateISO;
  today: DateISO;
  baseCurrency: string;
  rates: RateTable;
  accounts: readonly AccountSnapshot[];
  transactions: readonly Transaction[];
  rules: readonly RecurringRule[];
  exceptions: readonly RecurringException[];
  loanDues: readonly LoanDue[];
  /** Обмежити прогноз одним рахунком. */
  accountId?: string | null;
  scenarios?: readonly ScenarioEvent[];
}

export interface ForecastResult {
  days: ForecastDay[];
  byDate: Map<DateISO, ForecastDay>;
  /** Фактичний капітал на кінець сьогоднішнього дня. */
  currentBalance: Minor;
  baseCurrency: string;
  /** Валюти без заданого курсу — підсумки неповні. */
  missingRates: string[];
}

// ─── Побудова подій ─────────────────────────────────────────────────────

function conv(amount: Minor, currency: string, base: string, rates: RateTable): Minor | null {
  return toBase(amount, currency, base, rates);
}

/**
 * Вплив транзакції на капітал.
 *
 * Без фільтра переказ нейтральний (гроші лишаються у користувача), а при
 * крос-валютному переказі різниця курсів дає реальну переоцінку. З фільтром
 * по рахунку враховується лише та сторона переказу, що його стосується.
 */
function transactionDelta(
  tx: Transaction,
  base: string,
  rates: RateTable,
  accountCurrency: Map<string, string>,
  filter: string | null,
): { delta: Minor; unconverted: boolean } {
  const out = conv(tx.amount, tx.currency, base, rates);

  if (tx.kind === 'income') return { delta: out ?? 0, unconverted: out === null };
  if (tx.kind === 'expense') return { delta: -(out ?? 0), unconverted: out === null };
  if (tx.kind === 'adjustment') return { delta: out ?? 0, unconverted: out === null };

  // transfer
  const targetCurrency = tx.counterAccountId ? accountCurrency.get(tx.counterAccountId) : undefined;
  const inAmount = tx.counterAmount ?? tx.amount;
  const incoming = targetCurrency ? conv(inAmount, targetCurrency, base, rates) : null;

  if (filter) {
    if (tx.accountId === filter) return { delta: -(out ?? 0), unconverted: out === null };
    if (tx.counterAccountId === filter) return { delta: incoming ?? 0, unconverted: incoming === null };
    return { delta: 0, unconverted: false };
  }

  return {
    delta: (incoming ?? 0) - (out ?? 0),
    unconverted: out === null || incoming === null,
  };
}

function buildEvents(input: ForecastInput, rangeStart: DateISO, rangeEnd: DateISO): ForecastEvent[] {
  const { baseCurrency: base, rates, today } = input;
  const filter = input.accountId ?? null;
  const accountCurrency = new Map(input.accounts.map((a) => [a.id, a.currency]));
  const events: ForecastEvent[] = [];

  const touchesFilter = (accountId: string, counter: string | null) =>
    !filter || accountId === filter || counter === filter;

  // ── Транзакції ──
  // Матеріалізовані повторення запам'ятовуємо, щоб не додати їх ще раз
  // як подію правила.
  const materialized = new Set<string>();

  for (const tx of input.transactions) {
    if (tx.recurringRuleId && tx.recurringOccurrence) {
      materialized.add(occurrenceKey(tx.recurringRuleId, tx.recurringOccurrence));
    }
    if (tx.occurredOn < rangeStart || tx.occurredOn > rangeEnd) continue;
    if (!touchesFilter(tx.accountId, tx.counterAccountId)) continue;

    const { delta, unconverted } = transactionDelta(tx, base, rates, accountCurrency, filter);
    const isActual = tx.status === 'posted';

    events.push({
      key: `tx:${tx.id}`,
      source: 'transaction',
      kind: tx.kind,
      date: tx.occurredOn,
      delta,
      amount: tx.amount,
      currency: tx.currency,
      accountId: tx.accountId,
      counterAccountId: tx.counterAccountId,
      categoryId: tx.categoryId,
      title: tx.note ?? '',
      isActual,
      isOverdue: !isActual && tx.occurredOn < today,
      refId: tx.id,
      ...(tx.recurringRuleId ? { ruleId: tx.recurringRuleId } : {}),
      ...(tx.recurringOccurrence ? { occurrenceDate: tx.recurringOccurrence } : {}),
      unconverted,
    });
  }

  // ── Регулярні правила, які ще не стали транзакціями ──
  for (const occ of expandRules(input.rules, rangeStart, rangeEnd, input.exceptions)) {
    if (materialized.has(occurrenceKey(occ.ruleId, occ.occurrenceDate))) continue;

    const rule = input.rules.find((r) => r.id === occ.ruleId);
    if (!rule) continue;
    if (!touchesFilter(rule.accountId, rule.counterAccountId)) continue;

    const synthetic: Transaction = {
      id: `${rule.id}:${occ.occurrenceDate}`,
      kind: rule.kind,
      accountId: rule.accountId,
      counterAccountId: rule.counterAccountId,
      counterAmount: null,
      categoryId: rule.categoryId,
      amount: occ.amount,
      currency: rule.currency,
      occurredOn: occ.date,
      status: 'planned',
      note: occ.note,
      tags: [],
      recurringRuleId: rule.id,
      recurringOccurrence: occ.occurrenceDate,
    };
    const { delta, unconverted } = transactionDelta(synthetic, base, rates, accountCurrency, filter);

    events.push({
      key: `rule:${rule.id}:${occ.occurrenceDate}`,
      source: 'recurring',
      kind: rule.kind,
      date: occ.date,
      delta,
      amount: occ.amount,
      currency: rule.currency,
      accountId: rule.accountId,
      counterAccountId: rule.counterAccountId,
      categoryId: rule.categoryId,
      title: occ.note ?? '',
      isActual: false,
      isOverdue: occ.date < today,
      refId: rule.id,
      ruleId: rule.id,
      occurrenceDate: occ.occurrenceDate,
      unconverted,
    });
  }

  // ── Несплачені рядки графіків кредитів ──
  for (const due of input.loanDues) {
    if (due.status === 'paid' || due.status === 'skipped') continue;
    if (due.dueOn < rangeStart || due.dueOn > rangeEnd) continue;
    if (filter && due.accountId !== filter) continue;

    const converted = conv(due.amount, due.currency, base, rates);
    events.push({
      key: `loan:${due.id}`,
      source: 'loan',
      kind: 'loan_payment',
      date: due.dueOn,
      delta: -(converted ?? 0),
      amount: due.amount,
      currency: due.currency,
      accountId: due.accountId ?? '',
      counterAccountId: null,
      categoryId: due.categoryId,
      title: due.loanName,
      isActual: false,
      isOverdue: due.dueOn < today,
      refId: due.id,
      loanId: due.loanId,
      unconverted: converted === null,
    });
  }

  // ── Гіпотетичні події сценарію «а що, якщо» ──
  for (const [i, s] of (input.scenarios ?? []).entries()) {
    if (s.date < rangeStart || s.date > rangeEnd) continue;
    const converted = conv(s.amount, s.currency, base, rates);
    const signed = s.kind === 'income' ? (converted ?? 0) : -(converted ?? 0);
    events.push({
      key: `scenario:${i}`,
      source: 'scenario',
      kind: s.kind,
      date: s.date,
      delta: signed,
      amount: s.amount,
      currency: s.currency,
      accountId: s.accountId ?? '',
      counterAccountId: null,
      categoryId: null,
      title: s.title,
      isActual: false,
      isOverdue: false,
      refId: `scenario-${i}`,
      unconverted: converted === null,
    });
  }

  return events;
}

// ─── Основний розрахунок ────────────────────────────────────────────────

export function forecast(input: ForecastInput): ForecastResult {
  const { today, baseCurrency: base, rates } = input;
  const filter = input.accountId ?? null;

  const rangeStart = minDate(input.from, today);
  const rangeEnd = maxDate(input.to, today);

  // Поточний фактичний капітал.
  const scope = filter ? input.accounts.filter((a) => a.id === filter) : input.accounts;
  const missing = new Set<string>();
  let currentBalance = 0;
  for (const account of scope) {
    const converted = conv(account.balance, account.currency, base, rates);
    if (converted === null) missing.add(account.currency);
    else currentBalance += converted;
  }

  const events = buildEvents(input, rangeStart, rangeEnd);
  for (const e of events) if (e.unconverted) missing.add(e.currency);

  const byDate = new Map<DateISO, ForecastDay>();
  const dates = eachDay(rangeStart, rangeEnd);

  for (const date of dates) {
    byDate.set(date, {
      date,
      isPast: date < today,
      isToday: date === today,
      opening: 0,
      closing: 0,
      income: 0,
      expense: 0,
      loanPayments: 0,
      net: 0,
      events: [],
      hasDeficit: false,
    });
  }

  for (const event of events) {
    const day = byDate.get(event.date);
    if (!day) continue;
    day.events.push(event);

    if (event.kind === 'income') day.income += Math.abs(event.delta);
    else if (event.kind === 'loan_payment') day.loanPayments += Math.abs(event.delta);
    else if (event.kind === 'expense') day.expense += Math.abs(event.delta);
  }

  for (const day of byDate.values()) {
    day.net = day.income - day.expense - day.loanPayments;
    day.events.sort((a, b) => b.delta - a.delta);
  }

  const sumPosted = (date: DateISO) =>
    (byDate.get(date)?.events ?? []).reduce((s, e) => (e.isActual ? s + e.delta : s), 0);
  const sumPending = (date: DateISO) =>
    (byDate.get(date)?.events ?? []).reduce((s, e) => (e.isActual ? s : s + e.delta), 0);

  // Проведені операції з датою в майбутньому вже сидять у поточному балансі —
  // вилучаємо їх, щоб отримати чистий «факт на кінець сьогодні».
  let postedAhead = 0;
  for (const date of dates) {
    if (date > today) postedAhead += sumPosted(date);
  }
  const actualToday = currentBalance - postedAhead;

  // Назад: минулі дні — тільки фактичні рухи.
  let back = actualToday;
  const todayIndex = dates.indexOf(today);
  for (let i = todayIndex; i > 0; i--) {
    back -= sumPosted(dates[i]!);
    const prev = byDate.get(dates[i - 1]!)!;
    prev.closing = back;
  }

  // Вперед: від фактичного залишку додаємо лише невиконане.
  let forward = actualToday;
  for (let i = todayIndex; i < dates.length; i++) {
    const date = dates[i]!;
    const day = byDate.get(date)!;
    if (i > todayIndex) forward += sumPosted(date);
    forward += sumPending(date);
    day.closing = forward;
  }

  // Опенінг і дефіцити — одним проходом після того, як усі closing відомі.
  let previousClosing: Minor | null = null;
  const days: ForecastDay[] = [];
  for (const date of dates) {
    const day = byDate.get(date)!;
    day.opening = previousClosing ?? day.closing - (day.isPast ? sumPosted(date) : sumPending(date));
    day.hasDeficit = day.closing < 0;
    previousClosing = day.closing;
    days.push(day);
  }

  // Повертаємо лише запитаний діапазон, хоча рахували ширший.
  const visible = days.filter((d) => d.date >= input.from && d.date <= input.to);

  return {
    days: visible,
    byDate,
    currentBalance,
    baseCurrency: base,
    missingRates: [...missing],
  };
}

// ─── Зведення по горизонту ──────────────────────────────────────────────

export interface HorizonSummary {
  from: DateISO;
  to: DateISO;
  openingBalance: Minor;
  closingBalance: Minor;
  income: Minor;
  expense: Minor;
  loanPayments: Minor;
  net: Minor;
  minBalance: Minor;
  minBalanceDate: DateISO | null;
  deficitDates: DateISO[];
  biggestExpenses: ForecastEvent[];
  savingsRate: number;
}

export function summarize(result: ForecastResult, from?: DateISO, to?: DateISO): HorizonSummary {
  const days = result.days.filter((d) => (!from || d.date >= from) && (!to || d.date <= to));

  if (days.length === 0) {
    return {
      from: from ?? '',
      to: to ?? '',
      openingBalance: 0,
      closingBalance: 0,
      income: 0,
      expense: 0,
      loanPayments: 0,
      net: 0,
      minBalance: 0,
      minBalanceDate: null,
      deficitDates: [],
      biggestExpenses: [],
      savingsRate: 0,
    };
  }

  let income = 0;
  let expense = 0;
  let loanPayments = 0;
  let minBalance = Number.POSITIVE_INFINITY;
  let minBalanceDate: DateISO | null = null;
  const deficitDates: DateISO[] = [];
  const outflows: ForecastEvent[] = [];

  for (const day of days) {
    income += day.income;
    expense += day.expense;
    loanPayments += day.loanPayments;

    if (day.closing < minBalance) {
      minBalance = day.closing;
      minBalanceDate = day.date;
    }
    if (day.hasDeficit) deficitDates.push(day.date);

    for (const e of day.events) if (e.delta < 0) outflows.push(e);
  }

  const first = days[0]!;
  const last = days.at(-1)!;
  const net = income - expense - loanPayments;

  return {
    from: first.date,
    to: last.date,
    openingBalance: first.opening,
    closingBalance: last.closing,
    income,
    expense,
    loanPayments,
    net,
    minBalance: minBalance === Number.POSITIVE_INFINITY ? 0 : minBalance,
    minBalanceDate,
    deficitDates,
    biggestExpenses: outflows.sort((a, b) => a.delta - b.delta).slice(0, 5),
    savingsRate: income > 0 ? (net / income) * 100 : 0,
  };
}

// ─── Довідки для головного екрана ───────────────────────────────────────

export interface NextIncomeInfo {
  date: DateISO;
  amount: Minor;
  title: string;
  daysUntil: number;
  /** Скільки витрат заплановано до цієї дати. */
  plannedOutflow: Minor;
  /** Прогнозований залишок напередодні надходження. */
  balanceBefore: Minor;
  /** Чи вистачить грошей — тобто залишок не йде в мінус. */
  willHoldOut: boolean;
}

/**
 * «До наступної зарплати 8 днів, заплановано 9 500 ₴, залишиться 2 300 ₴».
 * Повертає null, коли надходжень попереду не видно.
 */
export function nextIncome(result: ForecastResult, today: DateISO): NextIncomeInfo | null {
  const future = result.days.filter((d) => d.date >= today);

  for (const day of future) {
    const incomeEvent = day.events.find((e) => e.kind === 'income' && !e.isActual && e.delta > 0);
    if (!incomeEvent || day.date === today) continue;

    const until = result.days.filter((d) => d.date >= today && d.date < day.date);
    const plannedOutflow = until.reduce((s, d) => s + d.expense + d.loanPayments, 0);
    const balanceBefore = until.at(-1)?.closing ?? result.currentBalance;
    const minOnWay = Math.min(...until.map((d) => d.closing), balanceBefore);

    return {
      date: day.date,
      amount: incomeEvent.delta,
      title: incomeEvent.title,
      daysUntil: until.length,
      plannedOutflow,
      balanceBefore,
      willHoldOut: minOnWay >= 0,
    };
  }

  return null;
}

/** Найближчі обов'язкові платежі: кредити та заплановані витрати. */
export function upcomingPayments(result: ForecastResult, today: DateISO, limit = 5): ForecastEvent[] {
  return result.days
    .filter((d) => d.date >= today)
    .flatMap((d) => d.events)
    .filter((e) => !e.isActual && e.delta < 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.delta - a.delta))
    .slice(0, limit);
}

/** Прострочені, але не виконані події — показуємо окремим попередженням. */
export function overdueEvents(result: ForecastResult): ForecastEvent[] {
  return result.days.flatMap((d) => d.events).filter((e) => e.isOverdue);
}

export const HORIZONS = [
  { key: '7d', label: '7 днів', days: 7 },
  { key: '30d', label: '30 днів', days: 30 },
  { key: '3m', label: '3 місяці', days: 92 },
  { key: '6m', label: '6 місяців', days: 183 },
  { key: '12m', label: '12 місяців', days: 365 },
] as const;

export type HorizonKey = (typeof HORIZONS)[number]['key'];

export function horizonRange(today: DateISO, key: HorizonKey): { from: DateISO; to: DateISO } {
  const spec = HORIZONS.find((h) => h.key === key) ?? HORIZONS[1];
  return { from: today, to: addDays(today, spec.days) };
}
