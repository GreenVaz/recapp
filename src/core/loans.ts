import {
  addMonths,
  daysInMonth,
  type DateISO,
  type MonthEndPolicy,
  fromParts,
  parts,
} from './dates.ts';
import { type Minor, percentOf, roundHalfAwayFromZero, splitEvenly } from './money.ts';
import type { Loan, LoanPayment, ScheduleRow, ScheduleType } from './types.ts';

/**
 * Графіки погашення кредитів і розстрочок.
 *
 * Два правила, яких дотримується кожен тип графіка:
 *
 *  1. Сума часток основного боргу дорівнює тілу кредиту до копійки.
 *     Залишок округлення завжди поглинає ОСТАННІЙ платіж — саме так
 *     працюють банківські графіки, і саме тому кредит закривається в нуль,
 *     а не в «−3 копійки».
 *
 *  2. amount === principalPart + interestPart + feePart. Жодних прихованих
 *     доданків: те, що бачить користувач у календарі, і є сумою списання.
 */

export interface ScheduleSpec {
  principal: Minor;
  /** Річна ставка у відсотках (18.5), не частка. */
  rateAnnual: number | null;
  scheduleType: ScheduleType;
  paymentsCount: number;
  firstPaymentOn: DateISO;
  paymentDay?: number | null;
  monthEndPolicy?: MonthEndPolicy;
  /** Для 'fixed_equal': загальна сума до виплати, коли ставка невідома. */
  totalDue?: Minor | null;
  feeFixed?: Minor;
  feePercent?: number;
  /** Для 'manual': готові рядки від користувача. */
  manualRows?: ReadonlyArray<{ dueOn: DateISO; amount: Minor; principalPart?: Minor }>;
}

export class ScheduleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScheduleError';
  }
}

/**
 * Дата платежу з урахуванням «числа місяця».
 *
 * Якщо вказано payment_day, він задає число для всієї серії; перший
 * платіж зсувається вперед, коли це число в місяці вже минуло.
 */
function anchorDate(firstPaymentOn: DateISO, paymentDay: number | null | undefined): DateISO {
  if (!paymentDay) return firstPaymentOn;

  const { year, month } = parts(firstPaymentOn);
  const day = Math.min(paymentDay, daysInMonth(year, month));
  const candidate = fromParts(year, month, day);
  if (candidate >= firstPaymentOn) return candidate;

  return addMonths(candidate, 1, 'clamp') ?? firstPaymentOn;
}

function dueDates(spec: ScheduleSpec): DateISO[] {
  const anchor = anchorDate(spec.firstPaymentOn, spec.paymentDay);
  const policy = spec.monthEndPolicy ?? 'clamp';
  const out: DateISO[] = [];

  for (let i = 0; out.length < spec.paymentsCount && i < spec.paymentsCount * 3; i++) {
    const d = addMonths(anchor, i, policy);
    if (d !== null) out.push(d);
  }
  return out;
}

const monthlyRate = (rateAnnual: number | null | undefined): number =>
  !rateAnnual || rateAnnual <= 0 ? 0 : rateAnnual / 100 / 12;

/** Ануїтетний платіж: P·i / (1 − (1+i)^−n). */
export function annuityPayment(principal: Minor, rateAnnual: number | null, n: number): Minor {
  const i = monthlyRate(rateAnnual);
  if (n <= 0) return 0;
  if (i === 0) return roundHalfAwayFromZero(principal / n);
  const factor = i / (1 - Math.pow(1 + i, -n));
  return roundHalfAwayFromZero(principal * factor);
}

function applyFees(spec: ScheduleSpec, paymentAmount: Minor): Minor {
  const fixed = spec.feeFixed ?? 0;
  const percent = spec.feePercent ? percentOf(paymentAmount, spec.feePercent) : 0;
  return fixed + percent;
}

export function buildSchedule(spec: ScheduleSpec): ScheduleRow[] {
  if (spec.scheduleType === 'manual') return buildManual(spec);

  if (spec.paymentsCount <= 0) {
    throw new ScheduleError('Кількість платежів має бути більшою за нуль');
  }
  if (spec.principal <= 0) {
    throw new ScheduleError('Сума кредиту має бути більшою за нуль');
  }

  const dates = dueDates(spec);
  if (dates.length < spec.paymentsCount) {
    throw new ScheduleError('Не вдалося побудувати дати платежів');
  }

  switch (spec.scheduleType) {
    case 'annuity':
      return buildAnnuity(spec, dates);
    case 'differentiated':
      return buildDifferentiated(spec, dates);
    case 'interest_free':
      return buildInterestFree(spec, dates);
    case 'fixed_equal':
      return buildFixedEqual(spec, dates);
  }
}

function buildAnnuity(spec: ScheduleSpec, dates: DateISO[]): ScheduleRow[] {
  const i = monthlyRate(spec.rateAnnual);
  if (i === 0) return buildInterestFree(spec, dates);

  const n = spec.paymentsCount;
  const payment = annuityPayment(spec.principal, spec.rateAnnual, n);
  const rows: ScheduleRow[] = [];
  let balance = spec.principal;

  for (let k = 0; k < n; k++) {
    const isLast = k === n - 1;
    const interestPart = roundHalfAwayFromZero(balance * i);

    // Останній платіж гасить усе, що лишилося, — інакше через округлення
    // кредит закрився б із «хвостом» у кілька копійок.
    const principalPart = isLast ? balance : Math.min(payment - interestPart, balance);
    const base = principalPart + interestPart;
    const feePart = applyFees(spec, base);

    balance -= principalPart;
    rows.push({
      seq: k + 1,
      dueOn: dates[k]!,
      amount: base + feePart,
      principalPart,
      interestPart,
      feePart,
      balanceAfter: balance,
      status: 'pending',
    });
  }

  return rows;
}

function buildDifferentiated(spec: ScheduleSpec, dates: DateISO[]): ScheduleRow[] {
  const i = monthlyRate(spec.rateAnnual);
  const principalParts = splitEvenly(spec.principal, spec.paymentsCount);
  const rows: ScheduleRow[] = [];
  let balance = spec.principal;

  for (let k = 0; k < spec.paymentsCount; k++) {
    const interestPart = roundHalfAwayFromZero(balance * i);
    const principalPart = principalParts[k]!;
    const base = principalPart + interestPart;
    const feePart = applyFees(spec, base);

    balance -= principalPart;
    rows.push({
      seq: k + 1,
      dueOn: dates[k]!,
      amount: base + feePart,
      principalPart,
      interestPart,
      feePart,
      balanceAfter: balance,
      status: 'pending',
    });
  }

  return rows;
}

function buildInterestFree(spec: ScheduleSpec, dates: DateISO[]): ScheduleRow[] {
  const principalParts = splitEvenly(spec.principal, spec.paymentsCount);
  const rows: ScheduleRow[] = [];
  let balance = spec.principal;

  for (let k = 0; k < spec.paymentsCount; k++) {
    const principalPart = principalParts[k]!;
    const feePart = applyFees(spec, principalPart);
    balance -= principalPart;
    rows.push({
      seq: k + 1,
      dueOn: dates[k]!,
      amount: principalPart + feePart,
      principalPart,
      interestPart: 0,
      feePart,
      balanceAfter: balance,
      status: 'pending',
    });
  }

  return rows;
}

/**
 * Користувач знає лише загальну суму до виплати і кількість платежів.
 * Переплату розподіляємо рівномірно, тіло кредиту — теж; залишок
 * округлення лягає на перші платежі (splitEvenly), а не губиться.
 */
function buildFixedEqual(spec: ScheduleSpec, dates: DateISO[]): ScheduleRow[] {
  const total = spec.totalDue ?? spec.principal;
  if (total < spec.principal) {
    throw new ScheduleError('Загальна сума до виплати менша за тіло кредиту');
  }

  const totals = splitEvenly(total, spec.paymentsCount);
  const principalParts = splitEvenly(spec.principal, spec.paymentsCount);
  const rows: ScheduleRow[] = [];
  let balance = spec.principal;

  for (let k = 0; k < spec.paymentsCount; k++) {
    const principalPart = principalParts[k]!;
    const interestPart = totals[k]! - principalPart;
    const feePart = applyFees(spec, totals[k]!);
    balance -= principalPart;
    rows.push({
      seq: k + 1,
      dueOn: dates[k]!,
      amount: totals[k]! + feePart,
      principalPart,
      interestPart,
      feePart,
      balanceAfter: balance,
      status: 'pending',
    });
  }

  return rows;
}

/**
 * Ручний графік. Якщо користувач не розділив тіло і відсотки,
 * тіло розкидається пропорційно сумам платежів.
 */
function buildManual(spec: ScheduleSpec): ScheduleRow[] {
  const manual = spec.manualRows ?? [];
  if (manual.length === 0) throw new ScheduleError('Ручний графік порожній');

  const totalAmount = manual.reduce((s, r) => s + r.amount, 0);
  const rows: ScheduleRow[] = [];
  let balance = spec.principal;
  let assigned = 0;

  manual.forEach((row, k) => {
    const isLast = k === manual.length - 1;
    let principalPart: Minor;

    if (row.principalPart !== undefined) {
      principalPart = row.principalPart;
    } else if (isLast) {
      principalPart = spec.principal - assigned;
    } else {
      principalPart =
        totalAmount > 0 ? roundHalfAwayFromZero((spec.principal * row.amount) / totalAmount) : 0;
    }

    principalPart = Math.max(0, Math.min(principalPart, balance));
    assigned += principalPart;
    balance -= principalPart;

    rows.push({
      seq: k + 1,
      dueOn: row.dueOn,
      amount: row.amount,
      principalPart,
      interestPart: Math.max(0, row.amount - principalPart),
      feePart: 0,
      balanceAfter: balance,
      status: 'pending',
    });
  });

  return rows;
}

// ─── Дострокове та часткове погашення ───────────────────────────────────

export type EarlyStrategy = 'reduce_term' | 'reduce_payment';

export interface RebuildInput {
  spec: ScheduleSpec;
  /** Залишок тіла боргу після врахування всіх фактичних виплат. */
  outstanding: Minor;
  /** Дата, з якої будується новий графік. */
  nextDueOn: DateISO;
  /** Скільки платежів лишалося за старим графіком. */
  remainingCount: number;
  /** Типовий платіж старого графіка — потрібен для reduce_term. */
  currentPayment: Minor;
  strategy: EarlyStrategy;
  startSeq: number;
}

/**
 * Перебудовує хвіст графіка після дострокового внеску.
 *
 *  - reduce_term: платіж лишається, зменшується кількість місяців;
 *  - reduce_payment: кількість місяців лишається, падає платіж.
 */
export function rebuildRemaining(input: RebuildInput): ScheduleRow[] {
  const { spec, outstanding, nextDueOn, remainingCount, currentPayment, strategy, startSeq } = input;
  if (outstanding <= 0) return [];

  const tailSpec: ScheduleSpec = {
    ...spec,
    principal: outstanding,
    firstPaymentOn: nextDueOn,
    paymentDay: spec.paymentDay ?? null,
    // Тіло вже змінилося, тож стара «загальна сума» більше не застосовна.
    totalDue: spec.scheduleType === 'fixed_equal' ? null : spec.totalDue,
    scheduleType: spec.scheduleType === 'fixed_equal' ? 'interest_free' : spec.scheduleType,
  };

  // Скорочення строку: платіж лишається рівно таким, як був, а графік
  // закінчується раніше. Саме так це роблять банки — користувач продовжує
  // платити звичну суму, просто менше місяців.
  const rows =
    strategy === 'reduce_term'
      ? buildWithFixedPayment(tailSpec, currentPayment)
      : buildSchedule({ ...tailSpec, paymentsCount: Math.max(1, remainingCount) });

  return rows.map((row, idx) => ({ ...row, seq: startSeq + idx }));
}

/**
 * Амортизація фіксованим платежем: кожен внесок дорівнює payment,
 * останній — лише залишок. Кількість платежів виходить сама.
 */
function buildWithFixedPayment(spec: ScheduleSpec, payment: Minor): ScheduleRow[] {
  const i = monthlyRate(spec.rateAnnual);
  const policy = spec.monthEndPolicy ?? 'clamp';
  const anchor = anchorDate(spec.firstPaymentOn, spec.paymentDay);

  const rows: ScheduleRow[] = [];
  let balance = spec.principal;

  for (let k = 0; balance > 0; k++) {
    if (k > 600) throw new ScheduleError('Платіж замалий, щоб погасити борг');

    const interestPart = roundHalfAwayFromZero(balance * i);
    const available = payment - interestPart;
    if (available <= 0) throw new ScheduleError('Платіж не покриває навіть відсотки');

    const principalPart = Math.min(available, balance);
    const base = principalPart + interestPart;
    const feePart = applyFees(spec, base);
    const dueOn = addMonths(anchor, k, policy);
    if (dueOn === null) continue;

    balance -= principalPart;
    rows.push({
      seq: k + 1,
      dueOn,
      amount: base + feePart,
      principalPart,
      interestPart,
      feePart,
      balanceAfter: balance,
      status: 'pending',
    });
  }

  return rows;
}

// ─── Зведення по кредиту ────────────────────────────────────────────────

export interface LoanSummary {
  principal: Minor;
  /** Залишок основного боргу — НЕ плутати із сумою майбутніх платежів. */
  outstandingPrincipal: Minor;
  principalPaid: Minor;
  interestPaid: Minor;
  feesPaid: Minor;
  interestRemaining: Minor;
  feesRemaining: Minor;
  /** Скільки ще належить сплатити разом із відсотками й комісіями. */
  remainingToPay: Minor;
  /** Повна вартість кредиту за весь строк. */
  totalCost: Minor;
  overpayment: Minor;
  progressPercent: number;
  monthlyPayment: Minor;
  nextPayment: ScheduleRow | null;
  closingDate: DateISO | null;
  paymentsMade: number;
  paymentsTotal: number;
  isClosed: boolean;
}

export function summarizeLoan(
  loan: Pick<Loan, 'principal' | 'isClosed'>,
  schedule: readonly ScheduleRow[],
  payments: readonly LoanPayment[],
): LoanSummary {
  const principalPaid = payments.reduce((s, p) => s + p.principalPart, 0);
  const interestPaid = payments.reduce((s, p) => s + p.interestPart, 0);
  const feesPaid = payments.reduce((s, p) => s + p.feePart, 0);

  const pending = schedule.filter((r) => r.status === 'pending' || r.status === 'partial');
  const interestRemaining = pending.reduce((s, r) => s + r.interestPart, 0);
  const feesRemaining = pending.reduce((s, r) => s + r.feePart, 0);
  const remainingToPay = pending.reduce((s, r) => s + r.amount, 0);

  const outstandingPrincipal = Math.max(0, loan.principal - principalPaid);
  const paidTotal = payments.reduce((s, p) => s + p.amount, 0);

  const sorted = [...pending].sort((a, b) => (a.dueOn < b.dueOn ? -1 : 1));
  const nextPayment = sorted[0] ?? null;
  const closingDate = sorted.at(-1)?.dueOn ?? null;

  // «Типовий» платіж — медіана, а не середнє: останній платіж у графіку
  // майже завжди менший і перекошував би середнє.
  const amounts = schedule.map((r) => r.amount).sort((a, b) => a - b);
  const monthlyPayment = amounts.length
    ? amounts[Math.floor(amounts.length / 2)]!
    : 0;

  const totalCost = paidTotal + remainingToPay;

  return {
    principal: loan.principal,
    outstandingPrincipal,
    principalPaid,
    interestPaid,
    feesPaid,
    interestRemaining,
    feesRemaining,
    remainingToPay,
    totalCost,
    overpayment: Math.max(0, totalCost - loan.principal),
    progressPercent: loan.principal > 0 ? Math.min(100, (principalPaid / loan.principal) * 100) : 0,
    monthlyPayment,
    nextPayment,
    closingDate,
    paymentsMade: payments.filter((p) => p.kind !== 'partial').length,
    paymentsTotal: schedule.length,
    isClosed: loan.isClosed || outstandingPrincipal === 0,
  };
}

/**
 * Розкладає фактичний платіж на відсотки / комісію / тіло.
 *
 * Порядок погашення стандартний: спершу комісія, потім нараховані
 * відсотки, і лише решта йде в тіло боргу. Переплата понад рядок графіка
 * теж іде в тіло — це і є дострокове погашення.
 */
export function allocatePayment(
  amount: Minor,
  row: Pick<ScheduleRow, 'interestPart' | 'feePart'> | null,
  outstandingPrincipal: Minor,
): { feePart: Minor; interestPart: Minor; principalPart: Minor; excess: Minor } {
  let rest = amount;

  const feePart = Math.min(rest, row?.feePart ?? 0);
  rest -= feePart;

  const interestPart = Math.min(rest, row?.interestPart ?? 0);
  rest -= interestPart;

  const principalPart = Math.min(rest, outstandingPrincipal);
  rest -= principalPart;

  return { feePart, interestPart, principalPart, excess: rest };
}
