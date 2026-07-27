"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Target } from "lucide-react";
import { api, put } from "@/lib/client";
import { formatMoney, toMajor } from "@/lib/money";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Progress, budgetTone } from "@/components/ui/Progress";
import { Icon } from "@/components/ui/Icon";
import type { BudgetDTO, CategoryDTO, SettingsDTO } from "@/types";
import type { Analytics } from "@/lib/analytics";

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const MONTH_NAMES = [
  "Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень",
  "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень",
];

export default function BudgetsPage() {
  const [cursor, setCursor] = useState(() => new Date());
  const [budgets, setBudgets] = useState<BudgetDTO[]>([]);
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const month = monthKey(cursor);
  const currency = settings?.baseCurrency ?? "UAH";

  const load = useCallback(async () => {
    setLoading(true);
    const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);

    try {
      const [b, c, a, s] = await Promise.all([
        api<BudgetDTO[]>(`/api/budgets?month=${month}`),
        api<CategoryDTO[]>("/api/categories?kind=EXPENSE"),
        api<Analytics>(
          `/api/analytics?from=${from.toISOString()}&to=${to.toISOString()}`,
        ),
        api<SettingsDTO>("/api/settings"),
      ]);
      setBudgets(b);
      setCategories(c);
      setAnalytics(a);
      setSettings(s);
      setDrafts(Object.fromEntries(b.map((x) => [x.categoryId, String(toMajor(x.amount))])));
    } finally {
      setLoading(false);
    }
  }, [cursor, month]);

  useEffect(() => {
    void load();
  }, [load]);

  // Факт по категорії беремо з аналітики — там уже враховані підкатегорії й курси.
  const spentByCategory = useMemo(
    () => new Map(Object.entries(analytics?.spentByCategory ?? {})),
    [analytics],
  );

  const parents = categories.filter((c) => !c.parentId);
  const budgetByCategory = new Map(budgets.map((b) => [b.categoryId, b]));

  async function save(categoryId: string) {
    const raw = drafts[categoryId] ?? "";
    setSavingId(categoryId);
    try {
      await put("/api/budgets", { categoryId, month, amount: raw === "" ? 0 : raw });
      await load();
    } finally {
      setSavingId(null);
    }
  }

  const totalPlanned = budgets.reduce((s, b) => s + b.amount, 0);
  const totalSpent = (analytics?.budgetProgress ?? []).reduce((s, b) => s + b.spent, 0);
  const totalShare = totalPlanned > 0 ? (totalSpent / totalPlanned) * 100 : 0;

  return (
    <>
      <PageHeader
        title="Бюджети"
        subtitle="Ліміти витрат за категоріями на місяць"
        action={
          <div className="flex items-center gap-1 rounded-xl border border-line bg-surface p-1">
            <button
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              className="btn-ghost p-1.5"
              aria-label="Попередній місяць"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="min-w-[9rem] text-center text-sm font-medium">
              {MONTH_NAMES[cursor.getMonth()]} {cursor.getFullYear()}
            </span>
            <button
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              className="btn-ghost p-1.5"
              aria-label="Наступний місяць"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        }
      />

      {totalPlanned > 0 && (
        <Card className="mb-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <p className="text-xs text-ink-soft">Загальний бюджет місяця</p>
              <p className="tabular text-lg font-semibold">
                {formatMoney(totalSpent, currency)}{" "}
                <span className="text-sm font-normal text-ink-faint">
                  із {formatMoney(totalPlanned, currency)}
                </span>
              </p>
            </div>
            <p className={`tabular text-sm font-medium ${budgetTone(totalShare).text}`}>
              {totalShare.toFixed(0)}%
            </p>
          </div>
          <Progress share={totalShare} className="h-2" />
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={20} className="animate-spin text-ink-faint" />
        </div>
      ) : parents.length === 0 ? (
        <Card>
          <EmptyState text="Немає категорій витрат. Створіть їх на сторінці «Категорії»." icon={<Target size={22} />} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {parents.map((parent) => {
            const children = categories.filter((c) => c.parentId === parent.id);
            const rows = [parent, ...children];

            return (
              <Card key={parent.id}>
                <CardHeader
                  title={parent.name}
                  subtitle={`${children.length} підкатегорій`}
                  action={
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-lg"
                      style={{ background: `${parent.color}1a`, color: parent.color }}
                    >
                      <Icon name={parent.icon} size={14} />
                    </span>
                  }
                />

                <ul className="space-y-3">
                  {rows.map((cat) => {
                    const budget = budgetByCategory.get(cat.id);
                    const spent = spentByCategory.get(cat.id) ?? 0;
                    const planned = budget?.amount ?? 0;
                    const share = planned > 0 ? (spent / planned) * 100 : 0;
                    const isParent = cat.id === parent.id;

                    return (
                      <li key={cat.id} className={isParent ? "" : "pl-3"}>
                        <div className="flex items-center gap-2">
                          <span
                            className={`min-w-0 flex-1 truncate text-xs ${
                              isParent ? "font-medium text-ink" : "text-ink-soft"
                            }`}
                          >
                            {isParent ? "Уся категорія" : cat.name}
                          </span>

                          <input
                            className="field tabular w-28 py-1.5 text-right text-xs"
                            inputMode="decimal"
                            placeholder="—"
                            value={drafts[cat.id] ?? ""}
                            onChange={(e) => setDrafts({ ...drafts, [cat.id]: e.target.value })}
                            onBlur={() => {
                              const current = budget ? String(toMajor(budget.amount)) : "";
                              if ((drafts[cat.id] ?? "") !== current) void save(cat.id);
                            }}
                            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                            aria-label={`Бюджет: ${cat.name}`}
                          />

                          {savingId === cat.id && (
                            <Loader2 size={13} className="animate-spin text-ink-faint" />
                          )}
                        </div>

                        {planned > 0 && (
                          <div className="mt-1.5">
                            <Progress share={share} />
                            <div className="mt-1 flex justify-between text-[0.625rem] text-ink-faint">
                              <span className="tabular">{formatMoney(spent, currency)}</span>
                              <span className={`tabular ${budgetTone(share).text}`}>
                                {share.toFixed(0)}%
                              </span>
                            </div>
                          </div>
                        )}
                        {planned === 0 && spent > 0 && (
                          <p className="tabular mt-1 text-[0.625rem] text-ink-faint">
                            витрачено {formatMoney(spent, currency)} без ліміту
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      <p className="mt-6 text-xs text-ink-faint">
        Суми в {currency}. Порожнє поле або 0 знімає ліміт. Зміни зберігаються автоматично.
      </p>
    </>
  );
}
