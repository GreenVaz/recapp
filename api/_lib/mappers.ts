import { parseNumeric, toNumeric, type Minor } from '../../src/core/money.ts';
import type {
  Account,
  Category,
  Loan,
  LoanPayment,
  RecurringException,
  RecurringRule,
  ScheduleRow,
  Transaction,
  UserSettings,
} from '../../src/core/types.ts';

/**
 * Межа між PostgreSQL і доменними типами.
 *
 * NUMERIC приходить рядком — тут він стає цілими мінорними одиницями, і в
 * зворотному напрямку теж. Це єдине місце, де існує рядкове представлення
 * грошей, тож помилка округлення не може просочитися в бізнес-логіку.
 */

type Row = Record<string, unknown>;

const str = (v: unknown): string => String(v ?? '');
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean => v === true || v === 't' || v === 'true';
const money = (v: unknown): Minor => parseNumeric(v as string);
const moneyOrNull = (v: unknown): Minor | null =>
  v === null || v === undefined ? null : parseNumeric(v as string);

/** DATE з драйвера вже рядок 'YYYY-MM-DD'; підстраховуємося на Date. */
const date = (v: unknown): string => {
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(
      v.getUTCDate(),
    ).padStart(2, '0')}`;
  }
  return String(v ?? '').slice(0, 10);
};
const dateOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : date(v));

export const toMoneyParam = (minor: Minor): string => toNumeric(minor);

export function mapAccount(row: Row): Account {
  return {
    id: str(row.id),
    name: str(row.name),
    type: str(row.type) as Account['type'],
    currency: str(row.currency),
    balance: money(row.balance ?? row.initial_balance),
    initialBalance: money(row.initial_balance),
    color: str(row.color),
    icon: str(row.icon),
    isArchived: bool(row.is_archived),
    sortOrder: num(row.sort_order),
  };
}

export function mapCategory(row: Row): Category {
  return {
    id: str(row.id),
    name: str(row.name),
    kind: str(row.kind) as Category['kind'],
    parentId: strOrNull(row.parent_id),
    icon: str(row.icon),
    color: str(row.color),
    isArchived: bool(row.is_archived),
  };
}

export function mapTransaction(row: Row): Transaction {
  return {
    id: str(row.id),
    kind: str(row.kind) as Transaction['kind'],
    accountId: str(row.account_id),
    counterAccountId: strOrNull(row.counter_account_id),
    counterAmount: moneyOrNull(row.counter_amount),
    categoryId: strOrNull(row.category_id),
    amount: money(row.amount),
    currency: str(row.currency),
    occurredOn: date(row.occurred_on),
    status: str(row.status) as Transaction['status'],
    note: strOrNull(row.note),
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    recurringRuleId: strOrNull(row.recurring_rule_id),
    recurringOccurrence: dateOrNull(row.recurring_occurrence),
  };
}

export function mapRule(row: Row): RecurringRule {
  return {
    id: str(row.id),
    kind: str(row.kind) as RecurringRule['kind'],
    accountId: str(row.account_id),
    counterAccountId: strOrNull(row.counter_account_id),
    categoryId: strOrNull(row.category_id),
    amount: money(row.amount),
    currency: str(row.currency),
    note: strOrNull(row.note),
    freq: str(row.freq) as RecurringRule['freq'],
    step: num(row.step),
    anchorDate: date(row.anchor_date),
    endDate: dateOrNull(row.end_date),
    maxOccurrences: numOrNull(row.max_occurrences),
    monthEndPolicy: str(row.month_end_policy) as RecurringRule['monthEndPolicy'],
    autoPost: bool(row.auto_post),
    isActive: bool(row.is_active),
  };
}

export function mapException(row: Row): RecurringException {
  return {
    ruleId: str(row.rule_id),
    occurrenceDate: date(row.occurrence_date),
    action: str(row.action) as RecurringException['action'],
    newDate: dateOrNull(row.new_date),
    newAmount: moneyOrNull(row.new_amount),
    newNote: strOrNull(row.new_note),
  };
}

export function mapLoan(row: Row): Loan {
  return {
    id: str(row.id),
    name: str(row.name),
    lender: strOrNull(row.lender),
    kind: str(row.kind) as Loan['kind'],
    principal: money(row.principal),
    currency: str(row.currency),
    openedOn: date(row.opened_on),
    termMonths: numOrNull(row.term_months),
    rateAnnual: row.rate_annual === null || row.rate_annual === undefined ? null : Number(row.rate_annual),
    scheduleType: str(row.schedule_type) as Loan['scheduleType'],
    paymentDay: numOrNull(row.payment_day),
    firstPaymentOn: date(row.first_payment_on),
    paymentsCount: numOrNull(row.payments_count),
    totalDue: moneyOrNull(row.total_due),
    feeFixed: money(row.fee_fixed),
    feePercent: Number(row.fee_percent ?? 0),
    accountId: strOrNull(row.account_id),
    categoryId: strOrNull(row.category_id),
    isClosed: bool(row.is_closed),
  };
}

export function mapScheduleRow(row: Row): ScheduleRow & { id: string } {
  return {
    id: str(row.id),
    seq: num(row.seq),
    dueOn: date(row.due_on),
    amount: money(row.amount),
    principalPart: money(row.principal_part),
    interestPart: money(row.interest_part),
    feePart: money(row.fee_part),
    balanceAfter: money(row.balance_after),
    status: str(row.status) as ScheduleRow['status'],
  };
}

export function mapLoanPayment(row: Row): LoanPayment {
  return {
    id: str(row.id),
    loanId: str(row.loan_id),
    scheduleId: strOrNull(row.schedule_id),
    transactionId: strOrNull(row.transaction_id),
    paidOn: date(row.paid_on),
    amount: money(row.amount),
    principalPart: money(row.principal_part),
    interestPart: money(row.interest_part),
    feePart: money(row.fee_part),
    kind: str(row.kind) as LoanPayment['kind'],
    earlyStrategy: strOrNull(row.early_strategy) as LoanPayment['earlyStrategy'],
  };
}

export function mapSettings(row: Row): UserSettings {
  return {
    baseCurrency: str(row.base_currency),
    theme: str(row.theme) as UserSettings['theme'],
    locale: str(row.locale),
    weekStart: num(row.week_start),
  };
}
