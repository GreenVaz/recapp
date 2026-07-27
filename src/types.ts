export interface AccountDTO {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance: number;
  color: string;
  isArchived: boolean;
  sortOrder: number;
  monoAccountId: string | null;
  monoMaskedPan: string | null;
  monoType: string | null;
  _count?: { transactions: number };
}

export interface CategoryDTO {
  id: string;
  name: string;
  kind: string;
  icon: string;
  color: string;
  parentId: string | null;
  sortOrder: number;
  _count?: { transactions: number; children: number };
}

export interface TransactionDTO {
  id: string;
  type: string;
  amount: number;
  toAmount: number | null;
  currency: string;
  date: string;
  note: string | null;
  tags: string;
  mcc: number | null;
  source: string;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  account: { id: string; name: string; currency: string; color: string };
  toAccount: { id: string; name: string; currency: string } | null;
  category: { id: string; name: string; icon: string; color: string; parentId: string | null } | null;
}

export interface BudgetDTO {
  id: string;
  month: string;
  amount: number;
  categoryId: string;
  category: { id: string; name: string; icon: string; color: string; parentId: string | null };
}

export interface RecurringDTO {
  id: string;
  name: string;
  type: string;
  amount: number;
  currency: string;
  frequency: string;
  anchorDate: string;
  nextDueDate: string;
  reminderDays: number;
  autoPost: boolean;
  isActive: boolean;
  lastPostedAt: string | null;
  note: string | null;
  accountId: string;
  categoryId: string | null;
  account: { id: string; name: string; currency: string };
  category: { id: string; name: string; icon: string; color: string } | null;
}

export interface SettingsDTO {
  baseCurrency: string;
  hasMonobankToken: boolean;
  monobankTokenHint: string | null;
  hasApiKey: boolean;
  defaultAccountId: string | null;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  rates: Array<{ id: string; base: string; quote: string; rate: number }>;
}

export interface MonoAccountDTO {
  id: string;
  title: string;
  type: string;
  currency: string;
  balance: number;
  maskedPan: string | null;
  iban: string | null;
  linkedTo: { id: string; name: string } | null;
}
