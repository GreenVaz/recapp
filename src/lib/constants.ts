export const CURRENCIES = ["UAH", "USD", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** ISO 4217 числові коди → буквені (Monobank віддає числові). */
export const CURRENCY_BY_NUMERIC: Record<number, string> = {
  980: "UAH",
  840: "USD",
  978: "EUR",
  826: "GBP",
  985: "PLN",
};

export const CURRENCY_SYMBOL: Record<string, string> = {
  UAH: "₴",
  USD: "$",
  EUR: "€",
  GBP: "£",
  PLN: "zł",
};

export const ACCOUNT_TYPES = ["CASH", "CARD", "SAVINGS", "JAR", "OTHER"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  CASH: "Готівка",
  CARD: "Картка",
  SAVINGS: "Заощадження",
  JAR: "Банка",
  OTHER: "Інше",
};

export const TX_TYPES = ["EXPENSE", "INCOME", "TRANSFER"] as const;
export type TxType = (typeof TX_TYPES)[number];

export const TX_TYPE_LABEL: Record<TxType, string> = {
  EXPENSE: "Витрата",
  INCOME: "Дохід",
  TRANSFER: "Переказ",
};

export const CATEGORY_KINDS = ["EXPENSE", "INCOME"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const FREQUENCIES = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const FREQUENCY_LABEL: Record<Frequency, string> = {
  WEEKLY: "Щотижня",
  MONTHLY: "Щомісяця",
  QUARTERLY: "Щокварталу",
  YEARLY: "Щороку",
};

export const TX_SOURCES = ["MANUAL", "MONOBANK", "API"] as const;
export type TxSource = (typeof TX_SOURCES)[number];

export const SOURCE_LABEL: Record<TxSource, string> = {
  MANUAL: "Вручну",
  MONOBANK: "Monobank",
  API: "Shortcuts",
};

/** Палітра для категорій і графіків — приглушені, читабельні на світлому тлі. */
export const CHART_PALETTE = [
  "#3f6f5c",
  "#c08a2e",
  "#8f5f8a",
  "#4a6f9c",
  "#c2554a",
  "#5f8a5c",
  "#a2763f",
  "#6b6f8f",
  "#9c6b5c",
  "#5c8f8a",
  "#8a8a5c",
  "#7a5f9c",
];
