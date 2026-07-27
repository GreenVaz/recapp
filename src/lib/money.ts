import { CURRENCY_SYMBOL } from "./constants";

/** Усі суми зберігаються в мінорних одиницях. Тут — межа між ними і UI. */

export function toMinor(value: number | string): number {
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : value;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function toMajor(minor: number): number {
  return minor / 100;
}

export function formatMoney(
  minor: number,
  currency = "UAH",
  opts: { sign?: boolean; compact?: boolean } = {},
): string {
  const value = toMajor(minor);
  const symbol = CURRENCY_SYMBOL[currency] ?? currency;

  if (opts.compact && Math.abs(value) >= 1000) {
    const formatted = new Intl.NumberFormat("uk-UA", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
    return `${formatted} ${symbol}`;
  }

  const formatted = new Intl.NumberFormat("uk-UA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));

  const prefix = opts.sign && value !== 0 ? (value > 0 ? "+" : "−") : value < 0 ? "−" : "";
  return `${prefix}${formatted} ${symbol}`;
}

export function formatPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}
