import type { DateISO, MonthEndPolicy } from './dates.ts';
import type { Minor } from './money.ts';

/** Доменні типи фінансового рушія. Жодних залежностей від React чи БД. */

export type TxKind = 'income' | 'expense' | 'transfer' | 'adjustment';
export type TxStatus = 'planned' | 'posted';
export type AccountType = 'card' | 'bank' | 'cash' | 'savings' | 'other';
export type CategoryKind = 'income' | 'expense';
export type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type LoanKind =
  | 'loan'
  | 'credit_card'
  | 'installment'
  | 'pay_in_parts'
  | 'personal'
  | 'interest_free';

export type ScheduleType = 'annuity' | 'differentiated' | 'interest_free' | 'fixed_equal' | 'manual';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  /** Поточний баланс, порахований БД із історії операцій. */
  balance: Minor;
  initialBalance: Minor;
  color: string;
  icon: string;
  isArchived: boolean;
  sortOrder: number;
}

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  parentId: string | null;
  icon: string;
  color: string;
  isArchived: boolean;
}

export interface Transaction {
  id: string;
  kind: TxKind;
  accountId: string;
  counterAccountId: string | null;
  counterAmount: Minor | null;
  categoryId: string | null;
  amount: Minor;
  currency: string;
  occurredOn: DateISO;
  status: TxStatus;
  note: string | null;
  tags: string[];
  recurringRuleId: string | null;
  recurringOccurrence: DateISO | null;
}

export interface RecurringRule {
  id: string;
  kind: 'income' | 'expense' | 'transfer';
  accountId: string;
  counterAccountId: string | null;
  categoryId: string | null;
  amount: Minor;
  currency: string;
  note: string | null;
  freq: Freq;
  step: number;
  anchorDate: DateISO;
  endDate: DateISO | null;
  maxOccurrences: number | null;
  monthEndPolicy: MonthEndPolicy;
  autoPost: boolean;
  isActive: boolean;
}

export type ExceptionAction = 'skip' | 'move' | 'override';

export interface RecurringException {
  ruleId: string;
  occurrenceDate: DateISO;
  action: ExceptionAction;
  newDate: DateISO | null;
  newAmount: Minor | null;
  newNote: string | null;
}

export interface Loan {
  id: string;
  name: string;
  lender: string | null;
  kind: LoanKind;
  principal: Minor;
  currency: string;
  openedOn: DateISO;
  termMonths: number | null;
  rateAnnual: number | null;
  scheduleType: ScheduleType;
  paymentDay: number | null;
  firstPaymentOn: DateISO;
  paymentsCount: number | null;
  totalDue: Minor | null;
  feeFixed: Minor;
  feePercent: number;
  accountId: string | null;
  categoryId: string | null;
  isClosed: boolean;
}

export type ScheduleStatus = 'pending' | 'paid' | 'partial' | 'skipped';

export interface ScheduleRow {
  id?: string;
  seq: number;
  dueOn: DateISO;
  amount: Minor;
  principalPart: Minor;
  interestPart: Minor;
  feePart: Minor;
  /** Залишок основного боргу ПІСЛЯ цього платежу. */
  balanceAfter: Minor;
  status: ScheduleStatus;
}

export interface LoanPayment {
  id: string;
  loanId: string;
  scheduleId: string | null;
  transactionId: string | null;
  paidOn: DateISO;
  amount: Minor;
  principalPart: Minor;
  interestPart: Minor;
  feePart: Minor;
  kind: 'scheduled' | 'extra' | 'partial';
  earlyStrategy: 'reduce_term' | 'reduce_payment' | null;
}

export interface UserSettings {
  baseCurrency: string;
  theme: 'dark' | 'light' | 'system';
  locale: string;
  weekStart: number;
}
