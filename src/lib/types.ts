import type { DateISO } from '@core/dates.js';
import type { LoanDue } from '@core/forecast.js';
import type { LoanSummary } from '@core/loans.js';
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
} from '@core/types.js';

/** Форми відповідей API, якими користується інтерфейс. */

export interface Me {
  id: string;
  email: string;
  displayName: string | null;
}

export interface RateRow {
  base: string;
  quote: string;
  rate: number;
}

export interface LoanBundle {
  loan: Loan;
  schedule: Array<ScheduleRow & { id: string }>;
  payments: LoanPayment[];
  summary: LoanSummary;
}

export interface Bootstrap {
  accounts: Account[];
  categories: Category[];
  settings: UserSettings;
  displayName: string | null;
  rates: RateRow[];
  loans: LoanBundle[];
}

export interface Ledger {
  from: DateISO;
  to: DateISO;
  transactions: Transaction[];
  rules: RecurringRule[];
  exceptions: RecurringException[];
  loanDues: LoanDue[];
}

export interface SettingsResponse extends UserSettings {
  displayName: string | null;
  rates: RateRow[];
}

export type { Account, Category, Loan, LoanPayment, RecurringRule, ScheduleRow, Transaction, UserSettings };
