import { prisma } from "./prisma";

export type RateTable = Record<string, number>;

/**
 * Будує таблицю «скільки одиниць baseCurrency за 1 одиницю валюти X».
 * Курси задаються вручну в налаштуваннях; відсутній курс = 1:1,
 * щоб зведені показники не зникали через незаповнений довідник.
 */
export async function buildRateTable(baseCurrency: string): Promise<RateTable> {
  const rows = await prisma.exchangeRate.findMany();
  const table: RateTable = { [baseCurrency]: 1 };

  for (const r of rows) {
    if (r.quote === baseCurrency) {
      table[r.base] = r.rate;
    } else if (r.base === baseCurrency && r.rate !== 0) {
      table[r.quote] = 1 / r.rate;
    }
  }
  return table;
}

export function convert(minor: number, from: string, to: string, table: RateTable): number {
  if (from === to) return minor;
  const rate = table[from];
  if (!rate) return minor; // курс не заданий — показуємо як є
  return Math.round(minor * rate);
}
