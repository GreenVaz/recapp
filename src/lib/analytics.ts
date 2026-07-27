import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { buildRateTable, convert, type RateTable } from "./fx";
import { getSettings } from "./settings";

export interface AnalyticsFilter {
  from: Date;
  to: Date;
  accountId?: string | null;
  categoryId?: string | null;
}

export interface Bucket {
  key: string;
  label: string;
  start: Date;
  end: Date;
}

const MONTHS_SHORT = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** До ~2 місяців рахуємо по днях, далі — по місяцях; інакше графіки нечитабельні. */
function buildBuckets(from: Date, to: Date): { granularity: "day" | "month"; buckets: Bucket[] } {
  const spanDays = Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
  const buckets: Bucket[] = [];

  if (spanDays <= 62) {
    const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    while (cursor <= to) {
      const start = new Date(cursor);
      const end = new Date(cursor);
      end.setHours(23, 59, 59, 999);
      buckets.push({
        key: start.toISOString().slice(0, 10),
        label: `${start.getDate()} ${MONTHS_SHORT[start.getMonth()]}`,
        start,
        end,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return { granularity: "day", buckets };
  }

  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cursor <= to) {
    const start = new Date(cursor);
    const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);
    buckets.push({
      key: monthKey(start),
      label: `${MONTHS_SHORT[start.getMonth()]} ${String(start.getFullYear()).slice(2)}`,
      start,
      end,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return { granularity: "month", buckets };
}

/** Категорія-фільтр розширюється на всіх нащадків — інакше вибір батька нічого не покаже. */
async function expandCategoryIds(categoryId: string): Promise<string[]> {
  const children = await prisma.category.findMany({
    where: { parentId: categoryId },
    select: { id: true },
  });
  return [categoryId, ...children.map((c) => c.id)];
}

async function buildWhere(filter: AnalyticsFilter): Promise<Prisma.TransactionWhereInput> {
  const where: Prisma.TransactionWhereInput = {
    date: { gte: filter.from, lte: filter.to },
  };
  if (filter.accountId) {
    where.OR = [{ accountId: filter.accountId }, { toAccountId: filter.accountId }];
  }
  if (filter.categoryId) {
    where.categoryId = { in: await expandCategoryIds(filter.categoryId) };
  }
  return where;
}

type TxRow = {
  id: string;
  type: string;
  amount: number;
  toAmount: number | null;
  currency: string;
  date: Date;
  note: string | null;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  account: { currency: string; name: string };
  toAccount: { currency: string; name: string } | null;
  category: { id: string; name: string; color: string; icon: string; parentId: string | null } | null;
};

/**
 * Вплив транзакції на сукупний капітал у базовій валюті.
 * Коли стоїть фільтр по рахунку — рахуємо лише його сторону переказу.
 */
function netEffect(tx: TxRow, rates: RateTable, base: string, accountFilter?: string | null): number {
  const out = convert(tx.amount, tx.account.currency, base, rates);
  if (tx.type === "INCOME") return out;
  if (tx.type === "EXPENSE") return -out;

  const inAmount = tx.toAccount
    ? convert(tx.toAmount ?? tx.amount, tx.toAccount.currency, base, rates)
    : 0;

  if (accountFilter) {
    if (tx.accountId === accountFilter) return -out;
    if (tx.toAccountId === accountFilter) return inAmount;
    return 0;
  }
  return inAmount - out;
}

export async function getAnalytics(filter: AnalyticsFilter) {
  const settings = await getSettings();
  const base = settings.baseCurrency;
  const rates = await buildRateTable(base);
  const where = await buildWhere(filter);
  const { granularity, buckets } = buildBuckets(filter.from, filter.to);

  const include = {
    account: { select: { currency: true, name: true } },
    toAccount: { select: { currency: true, name: true } },
    category: { select: { id: true, name: true, color: true, icon: true, parentId: true } },
  } as const;

  const [transactions, accounts, categories] = await Promise.all([
    prisma.transaction.findMany({ where, include, orderBy: { date: "asc" } }) as Promise<TxRow[]>,
    prisma.account.findMany({
      where: filter.accountId ? { id: filter.accountId } : { isArchived: false },
      select: { id: true, balance: true, currency: true, name: true, color: true },
    }),
    prisma.category.findMany({
      select: { id: true, name: true, color: true, icon: true, parentId: true, kind: true },
    }),
  ]);

  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const inBase = (minor: number, currency: string) => convert(minor, currency, base, rates);

  // ── KPI ────────────────────────────────────────────────────────────────
  let totalIncome = 0;
  let totalExpense = 0;

  for (const tx of transactions) {
    if (tx.type === "INCOME") totalIncome += inBase(tx.amount, tx.account.currency);
    else if (tx.type === "EXPENSE") totalExpense += inBase(tx.amount, tx.account.currency);
  }

  const netWorth = accounts.reduce((sum, a) => sum + inBase(a.balance, a.currency), 0);

  // ── 1. Структура витрат за категоріями (donut) ─────────────────────────
  // Групуємо по батьківській категорії, деталізацію тримаємо в children.
  const byParent = new Map<
    string,
    { id: string; name: string; color: string; icon: string; amount: number; children: Map<string, { name: string; amount: number }> }
  >();

  for (const tx of transactions) {
    if (tx.type !== "EXPENSE") continue;
    const amount = inBase(tx.amount, tx.account.currency);
    const cat = tx.categoryId ? categoryById.get(tx.categoryId) : null;
    const parent = cat?.parentId ? categoryById.get(cat.parentId) : cat;

    const parentId = parent?.id ?? "__none__";
    if (!byParent.has(parentId)) {
      byParent.set(parentId, {
        id: parentId,
        name: parent?.name ?? "Без категорії",
        color: parent?.color ?? "#b8b8b2",
        icon: parent?.icon ?? "CircleHelp",
        amount: 0,
        children: new Map(),
      });
    }
    const entry = byParent.get(parentId)!;
    entry.amount += amount;

    const childName = cat && cat.parentId ? cat.name : "Інше";
    const child = entry.children.get(childName) ?? { name: childName, amount: 0 };
    child.amount += amount;
    entry.children.set(childName, child);
  }

  const expenseStructure = [...byParent.values()]
    .map((e) => ({
      id: e.id,
      name: e.name,
      color: e.color,
      icon: e.icon,
      amount: e.amount,
      share: totalExpense > 0 ? (e.amount / totalExpense) * 100 : 0,
      children: [...e.children.values()].sort((a, b) => b.amount - a.amount),
    }))
    .sort((a, b) => b.amount - a.amount);

  // ── 2. Динаміка доходів і витрат + 6. Заощадження ──────────────────────
  const bucketIndex = new Map(buckets.map((b, i) => [b.key, i]));
  const keyOf = (d: Date) =>
    granularity === "day"
      ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10)
      : monthKey(d);

  const series = buckets.map((b) => ({ key: b.key, label: b.label, income: 0, expense: 0, net: 0 }));

  for (const tx of transactions) {
    const idx = bucketIndex.get(keyOf(tx.date));
    if (idx === undefined) continue;
    const amount = inBase(tx.amount, tx.account.currency);
    if (tx.type === "INCOME") series[idx].income += amount;
    else if (tx.type === "EXPENSE") series[idx].expense += amount;
  }
  for (const point of series) point.net = point.income - point.expense;

  let running = 0;
  const savings = series.map((p) => {
    running += p.net;
    return { key: p.key, label: p.label, net: p.net, cumulative: running };
  });

  // ── 3. Тренд чистого капіталу ──────────────────────────────────────────
  // Ідемо назад від поточного капіталу, віднімаючи вплив пізніших операцій.
  const afterRange = (await prisma.transaction.findMany({
    where: {
      date: { gt: filter.to },
      ...(filter.accountId
        ? { OR: [{ accountId: filter.accountId }, { toAccountId: filter.accountId }] }
        : {}),
    },
    include,
  })) as TxRow[];

  let worthAtEnd = netWorth;
  for (const tx of afterRange) {
    worthAtEnd -= netEffect(tx, rates, base, filter.accountId);
  }

  const effectPerBucket = new Array(buckets.length).fill(0);
  const rangeTx = filter.categoryId
    ? ((await prisma.transaction.findMany({
        where: {
          date: { gte: filter.from, lte: filter.to },
          ...(filter.accountId
            ? { OR: [{ accountId: filter.accountId }, { toAccountId: filter.accountId }] }
            : {}),
        },
        include,
      })) as TxRow[])
    : transactions; // без фільтра по категорії вибірка вже повна

  for (const tx of rangeTx) {
    const idx = bucketIndex.get(keyOf(tx.date));
    if (idx === undefined) continue;
    effectPerBucket[idx] += netEffect(tx, rates, base, filter.accountId);
  }

  const netWorthTrend: Array<{ key: string; label: string; value: number }> = [];
  let cursorWorth = worthAtEnd;
  for (let i = buckets.length - 1; i >= 0; i--) {
    netWorthTrend[i] = { key: buckets[i].key, label: buckets[i].label, value: cursorWorth };
    cursorWorth -= effectPerBucket[i];
  }

  // ── 4. Бюджети vs факт ─────────────────────────────────────────────────
  const months = [...new Set(buckets.map((b) => monthKey(b.start)))];
  const budgets = await prisma.budget.findMany({
    where: { month: { in: months } },
    include: { category: { select: { id: true, name: true, color: true, icon: true, parentId: true } } },
  });

  // Факт рахуємо по парі (категорія, місяць): бюджет існує не в кожному місяці
  // діапазону, і зіставляти річні витрати з одним місячним планом було б хибно.
  // Витрата на підкатегорію зараховується і в бюджет її батька.
  const spentByCategoryMonth = new Map<string, number>();
  const spentByCategory = new Map<string, number>();
  const addSpent = (categoryId: string, month: string, amount: number) => {
    const key = `${categoryId}:${month}`;
    spentByCategoryMonth.set(key, (spentByCategoryMonth.get(key) ?? 0) + amount);
    spentByCategory.set(categoryId, (spentByCategory.get(categoryId) ?? 0) + amount);
  };

  for (const tx of transactions) {
    if (tx.type !== "EXPENSE" || !tx.categoryId) continue;
    const amount = inBase(tx.amount, tx.account.currency);
    const month = monthKey(tx.date);
    addSpent(tx.categoryId, month, amount);
    const cat = categoryById.get(tx.categoryId);
    if (cat?.parentId) addSpent(cat.parentId, month, amount);
  }

  const budgetRollup = new Map<
    string,
    { categoryId: string; name: string; color: string; icon: string; planned: number; spent: number; months: number }
  >();
  for (const b of budgets) {
    const entry = budgetRollup.get(b.categoryId) ?? {
      categoryId: b.categoryId,
      name: b.category.name,
      color: b.category.color,
      icon: b.category.icon,
      planned: 0,
      spent: 0,
      months: 0,
    };
    entry.planned += b.amount;
    entry.spent += spentByCategoryMonth.get(`${b.categoryId}:${b.month}`) ?? 0;
    entry.months += 1;
    budgetRollup.set(b.categoryId, entry);
  }

  const budgetProgress = [...budgetRollup.values()]
    .map((b) => {
      const share = b.planned > 0 ? (b.spent / b.planned) * 100 : 0;
      return {
        ...b,
        remaining: b.planned - b.spent,
        share,
        status: share >= 100 ? "over" : share >= 80 ? "warn" : "ok",
      };
    })
    .sort((a, b) => b.share - a.share);

  // ── 5. Топ-5 категорій витрат ──────────────────────────────────────────
  const leafTotals = new Map<string, { name: string; color: string; icon: string; amount: number; count: number; parentName: string }>();
  for (const tx of transactions) {
    if (tx.type !== "EXPENSE") continue;
    const cat = tx.categoryId ? categoryById.get(tx.categoryId) : null;
    const id = cat?.id ?? "__none__";
    const parentName = cat?.parentId ? (categoryById.get(cat.parentId)?.name ?? "") : "";
    const entry = leafTotals.get(id) ?? {
      name: cat?.name ?? "Без категорії",
      color: cat?.color ?? "#b8b8b2",
      icon: cat?.icon ?? "CircleHelp",
      amount: 0,
      count: 0,
      parentName,
    };
    entry.amount += inBase(tx.amount, tx.account.currency);
    entry.count += 1;
    leafTotals.set(id, entry);
  }
  const topCategories = [...leafTotals.entries()]
    .map(([id, v]) => ({ id, ...v, share: totalExpense > 0 ? (v.amount / totalExpense) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const largestTransactions = transactions
    .filter((t) => t.type === "EXPENSE")
    .map((t) => ({
      id: t.id,
      note: t.note,
      date: t.date,
      amount: inBase(t.amount, t.account.currency),
      categoryName: t.categoryId ? (categoryById.get(t.categoryId)?.name ?? "—") : "—",
      accountName: t.account.name,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  return {
    baseCurrency: base,
    granularity,
    kpi: {
      income: totalIncome,
      expense: totalExpense,
      net: totalIncome - totalExpense,
      netWorth,
      savingsRate: totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : 0,
      transactionCount: transactions.length,
    },
    expenseStructure,
    series,
    netWorthTrend,
    budgetProgress,
    /** categoryId → витрачено (з урахуванням підкатегорій). Для сторінки бюджетів. */
    spentByCategory: Object.fromEntries(spentByCategory),
    topCategories,
    largestTransactions,
    savings,
    accounts: accounts.map((a) => ({ ...a, balanceBase: inBase(a.balance, a.currency) })),
  };
}

export type Analytics = Awaited<ReturnType<typeof getAnalytics>>;
