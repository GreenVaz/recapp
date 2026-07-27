import Link from "next/link";
import { CalendarClock, Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getAnalytics } from "@/lib/analytics";
import { getDueReminders } from "@/lib/recurring";
import { formatMoney } from "@/lib/money";
import { PageHeader } from "@/components/PageHeader";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { KpiRow } from "@/components/dashboard/KpiRow";
import {
  BudgetChart,
  ExpenseStructure,
  IncomeExpenseChart,
  NetWorthChart,
  SavingsChart,
  TopCategories,
} from "@/components/dashboard/Charts";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;

  const now = new Date();
  const from = one(sp.from) ? new Date(one(sp.from)!) : new Date(now.getFullYear(), now.getMonth(), 1);
  // Кінець дня, інакше операції «сьогодні» випадають із вибірки.
  const toRaw = one(sp.to) ? new Date(one(sp.to)!) : now;
  const to = new Date(toRaw.getFullYear(), toRaw.getMonth(), toRaw.getDate(), 23, 59, 59, 999);

  const [analytics, accounts, categories, reminders] = await Promise.all([
    getAnalytics({
      from,
      to,
      accountId: one(sp.accountId) ?? null,
      categoryId: one(sp.categoryId) ?? null,
    }),
    prisma.account.findMany({
      where: { isArchived: false },
      select: { id: true, name: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.category.findMany({
      where: { kind: "EXPENSE" },
      select: { id: true, name: true, parentId: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    getDueReminders(),
  ]);

  const currency = analytics.baseCurrency;

  return (
    <>
      <PageHeader
        title="Дашборд"
        subtitle={`${from.toLocaleDateString("uk-UA")} — ${to.toLocaleDateString("uk-UA")}`}
        action={
          <Link href="/transactions?new=1" className="btn-primary">
            <Plus size={16} />
            Додати операцію
          </Link>
        }
      />

      <FilterBar accounts={accounts} categories={categories} />

      {reminders.length > 0 && (
        <div className="card mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-warning/25 bg-warning/[0.04] p-4">
          <CalendarClock size={16} className="text-warning" />
          <p className="text-xs font-medium text-ink">
            Найближчі платежі ({reminders.length})
          </p>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {reminders.slice(0, 4).map((r) => (
              <li key={r.id} className="text-xs text-ink-soft">
                {r.name} —{" "}
                <span className="tabular font-medium text-ink">
                  {formatMoney(r.amount, r.currency)}
                </span>{" "}
                <span className="text-ink-faint">
                  {r.daysLeft < 0
                    ? `прострочено на ${-r.daysLeft} дн.`
                    : r.daysLeft === 0
                      ? "сьогодні"
                      : `через ${r.daysLeft} дн.`}
                </span>
              </li>
            ))}
          </ul>
          <Link href="/recurring" className="btn-ghost ml-auto px-2 py-1 text-xs">
            Усі платежі
          </Link>
        </div>
      )}

      <KpiRow kpi={analytics.kpi} currency={currency} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ExpenseStructure data={analytics.expenseStructure} currency={currency} />
        <IncomeExpenseChart
          data={analytics.series}
          currency={currency}
          granularity={analytics.granularity}
        />
        <NetWorthChart data={analytics.netWorthTrend} currency={currency} />
        <BudgetChart data={analytics.budgetProgress} currency={currency} />
        <TopCategories
          categories={analytics.topCategories}
          transactions={analytics.largestTransactions}
          currency={currency}
        />
        <SavingsChart
          data={analytics.savings}
          savingsRate={analytics.kpi.savingsRate}
          currency={currency}
        />
      </div>
    </>
  );
}
