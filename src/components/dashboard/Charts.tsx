"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import { formatMoney } from "@/lib/money";
import { Icon } from "@/components/ui/Icon";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Progress, budgetTone } from "@/components/ui/Progress";
import type { Analytics } from "@/lib/analytics";

const AXIS = { stroke: "#94948e", fontSize: 11 };
const GRID = "#eeeeea";

function compact(minor: number, currency: string) {
  return formatMoney(minor, currency, { compact: true });
}

/** Підпис осі — без символа валюти: він не влазить і переноситься на два рядки. */
function axisTick(minor: number) {
  return new Intl.NumberFormat("uk-UA", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(minor / 100);
}

function ChartTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: Record<string, unknown> }>;
  label?: string;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-pop">
      {label && <p className="mb-1 text-xs font-medium text-ink">{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-2 text-xs text-ink-soft">
          <span className="h-2 w-2 rounded-full" style={{ background: entry.color }} />
          {entry.name}
          <span className="tabular ml-auto font-medium text-ink">
            {formatMoney(Number(entry.value ?? 0), currency)}
          </span>
        </p>
      ))}
    </div>
  );
}

/* ── 1. Структура витрат ─────────────────────────────────────────────── */

export function ExpenseStructure({
  data,
  currency,
}: {
  data: Analytics["expenseStructure"];
  currency: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const total = data.reduce((s, d) => s + d.amount, 0);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader title="Структура витрат" subtitle="Розподіл за категоріями" />
      {data.length === 0 ? (
        <EmptyState text="За обраний період витрат немає." />
      ) : (
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center">
          <div className="relative h-56 w-full lg:w-56 lg:shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="amount"
                  nameKey="name"
                  innerRadius="62%"
                  outerRadius="92%"
                  paddingAngle={2}
                  stroke="none"
                >
                  {data.map((d) => (
                    <Cell key={d.id} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip currency={currency} />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-[0.6875rem] text-ink-faint">Разом</p>
              <p className="tabular text-sm font-semibold">{compact(total, currency)}</p>
            </div>
          </div>

          <ul className="flex-1 space-y-1">
            {data.slice(0, 7).map((d) => (
              <li key={d.id}>
                <button
                  onClick={() => setExpanded(expanded === d.id ? null : d.id)}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-canvas"
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: `${d.color}1a`, color: d.color }}
                  >
                    <Icon name={d.icon} size={13} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">{d.name}</span>
                  <span className="tabular text-xs text-ink-faint">{d.share.toFixed(1)}%</span>
                  <span className="tabular w-24 text-right text-xs font-medium text-ink">
                    {formatMoney(d.amount, currency)}
                  </span>
                </button>

                {expanded === d.id && d.children.length > 0 && (
                  <ul className="mb-1 ml-10 space-y-0.5 animate-fade-in">
                    {d.children.map((c) => (
                      <li key={c.name} className="flex items-center gap-2 py-0.5 text-[0.6875rem]">
                        <span className="min-w-0 flex-1 truncate text-ink-soft">{c.name}</span>
                        <span className="tabular text-ink-faint">{formatMoney(c.amount, currency)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/* ── 2. Доходи vs Витрати ────────────────────────────────────────────── */

export function IncomeExpenseChart({
  data,
  currency,
  granularity,
}: {
  data: Analytics["series"];
  currency: string;
  granularity: string;
}) {
  const hasData = data.some((d) => d.income > 0 || d.expense > 0);

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title="Доходи та витрати"
        subtitle={granularity === "day" ? "По днях" : "По місяцях"}
        action={
          <div className="flex gap-3 text-[0.6875rem] text-ink-soft">
            <Legend color="#3f6f5c" label="Дохід" />
            <Legend color="#c2554a" label="Витрата" />
            <Legend color="#1c1c1a" label="Чисто" dashed />
          </div>
        }
      />
      {!hasData ? (
        <EmptyState text="Немає операцій за період." />
      ) : (
        <div className="min-h-[15rem] flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 4, right: 4, left: -6, bottom: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} {...AXIS} interval="preserveStartEnd" />
              <YAxis
                tickLine={false}
                axisLine={false}
                {...AXIS}
                tickFormatter={(v) => axisTick(Number(v))}
                width={58}
              />
              <Tooltip content={<ChartTooltip currency={currency} />} cursor={{ fill: "#f3f3f0" }} />
              <Bar dataKey="income" name="Дохід" fill="#3f6f5c" radius={[4, 4, 0, 0]} maxBarSize={26} />
              <Bar dataKey="expense" name="Витрата" fill="#c2554a" radius={[4, 4, 0, 0]} maxBarSize={26} />
              <Line
                type="monotone"
                dataKey="net"
                name="Чисто"
                stroke="#1c1c1a"
                strokeWidth={1.6}
                strokeDasharray="4 3"
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function Legend({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: dashed ? "transparent" : color, border: dashed ? `1.5px dashed ${color}` : "none" }}
      />
      {label}
    </span>
  );
}

/* ── 3. Тренд чистого капіталу ───────────────────────────────────────── */

export function NetWorthChart({
  data,
  currency,
}: {
  data: Analytics["netWorthTrend"];
  currency: string;
}) {
  const first = data[0]?.value ?? 0;
  const last = data[data.length - 1]?.value ?? 0;
  const delta = last - first;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title="Чистий капітал"
        subtitle="Сумарний баланс усіх рахунків"
        action={
          <div className="text-right">
            <p className="tabular text-sm font-semibold">{formatMoney(last, currency)}</p>
            <p className={`tabular text-xs ${delta >= 0 ? "text-positive" : "text-negative"}`}>
              {formatMoney(delta, currency, { sign: true })} за період
            </p>
          </div>
        }
      />
      {data.length === 0 ? (
        <EmptyState text="Немає даних для побудови тренду." />
      ) : (
        <div className="min-h-[14rem] flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, left: -6, bottom: 0 }}>
              <defs>
                <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3f6f5c" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="#3f6f5c" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} {...AXIS} interval="preserveStartEnd" />
              <YAxis
                tickLine={false}
                axisLine={false}
                {...AXIS}
                tickFormatter={(v) => axisTick(Number(v))}
                width={58}
                domain={["auto", "auto"]}
              />
              <Tooltip content={<ChartTooltip currency={currency} />} />
              <Area
                type="monotone"
                dataKey="value"
                name="Капітал"
                stroke="#3f6f5c"
                strokeWidth={2}
                fill="url(#netWorthFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

/* ── 4. Бюджети vs факт ──────────────────────────────────────────────── */

export function BudgetChart({
  data,
  currency,
}: {
  data: Analytics["budgetProgress"];
  currency: string;
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader title="Бюджети та факт" subtitle="Заплановано проти витраченого" />
      {data.length === 0 ? (
        <EmptyState text="Бюджети не задані. Створіть їх на сторінці «Бюджети»." />
      ) : (
        <ul className="space-y-3.5">
          {data.slice(0, 8).map((b) => {
            const tone = budgetTone(b.share);
            return (
              <li key={b.categoryId}>
                <div className="mb-1.5 flex items-center gap-2">
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                    style={{ background: `${b.color}1a`, color: b.color }}
                  >
                    <Icon name={b.icon} size={11} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{b.name}</span>
                  <span className={`tabular text-xs font-medium ${tone.text}`}>
                    {b.share.toFixed(0)}%
                  </span>
                </div>
                <Progress share={b.share} />
                <div className="mt-1 flex justify-between text-[0.6875rem] text-ink-faint">
                  <span className="tabular">{formatMoney(b.spent, currency)}</span>
                  <span className="tabular">
                    {b.remaining >= 0
                      ? `лишилось ${formatMoney(b.remaining, currency)}`
                      : `перевитрата ${formatMoney(-b.remaining, currency)}`}
                    {" · "}
                    план {formatMoney(b.planned, currency)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ── 5. Топ категорій і найбільші витрати ────────────────────────────── */

export function TopCategories({
  categories,
  transactions,
  currency,
}: {
  categories: Analytics["topCategories"];
  transactions: Analytics["largestTransactions"];
  currency: string;
}) {
  const [tab, setTab] = useState<"categories" | "transactions">("categories");
  const max = categories[0]?.amount ?? 1;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title="Найбільші витрати"
        subtitle="Топ-5 за обраний період"
        action={
          <div className="flex gap-0.5 rounded-lg bg-canvas p-0.5">
            {(
              [
                ["categories", "Категорії"],
                ["transactions", "Операції"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-md px-2 py-1 text-[0.6875rem] font-medium transition-colors ${
                  tab === key ? "bg-surface text-ink shadow-card" : "text-ink-soft hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />

      {tab === "categories" ? (
        categories.length === 0 ? (
          <EmptyState text="Немає витрат за період." />
        ) : (
          <ul className="space-y-3">
            {categories.map((c, i) => (
              <li key={c.id} className="flex items-center gap-3">
                <span className="tabular w-4 text-xs text-ink-faint">{i + 1}</span>
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: `${c.color}1a`, color: c.color }}
                >
                  <Icon name={c.icon} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-xs font-medium text-ink">{c.name}</p>
                    <p className="tabular shrink-0 text-xs font-medium">
                      {formatMoney(c.amount, currency)}
                    </p>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
                      <div
                        className="h-full rounded-full transition-[width] duration-500"
                        style={{ width: `${(c.amount / max) * 100}%`, background: c.color }}
                      />
                    </div>
                    <span className="tabular shrink-0 text-[0.625rem] text-ink-faint">
                      {c.count} оп. · {c.share.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : transactions.length === 0 ? (
        <EmptyState text="Немає витрат за період." />
      ) : (
        <ul className="divide-y divide-line">
          {transactions.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-ink">{t.note || "Без опису"}</p>
                <p className="mt-0.5 truncate text-[0.6875rem] text-ink-faint">
                  {t.categoryName} · {t.accountName} ·{" "}
                  {new Date(t.date).toLocaleDateString("uk-UA", { day: "numeric", month: "short" })}
                </p>
              </div>
              <p className="tabular shrink-0 text-xs font-medium text-negative">
                −{formatMoney(t.amount, currency)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ── 6. Накопичення ──────────────────────────────────────────────────── */

export function SavingsChart({
  data,
  savingsRate,
  currency,
}: {
  data: Analytics["savings"];
  savingsRate: number;
  currency: string;
}) {
  const total = data[data.length - 1]?.cumulative ?? 0;
  const positive = total >= 0;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader
        title="Накопичення"
        subtitle="Доходи мінус витрати, наростаючим підсумком"
        action={
          <div className="text-right">
            <p className={`tabular text-sm font-semibold ${positive ? "text-positive" : "text-negative"}`}>
              {formatMoney(total, currency, { sign: true })}
            </p>
            <p className="text-xs text-ink-faint">норма {savingsRate.toFixed(0)}%</p>
          </div>
        }
      />
      {data.length === 0 ? (
        <EmptyState text="Немає даних за період." />
      ) : (
        <div className="min-h-[14rem] flex-1">
          <ResponsiveContainer width="100%" height="100%">
            {/* ComposedChart, а не AreaChart — стовпчик «за період» поверх площі. */}
            <ComposedChart data={data} margin={{ top: 4, right: 4, left: -6, bottom: 0 }}>
              <defs>
                <linearGradient id="savingsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={positive ? "#2f7d5f" : "#c2554a"} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={positive ? "#2f7d5f" : "#c2554a"} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} {...AXIS} interval="preserveStartEnd" />
              <YAxis
                tickLine={false}
                axisLine={false}
                {...AXIS}
                tickFormatter={(v) => axisTick(Number(v))}
                width={58}
              />
              <Tooltip content={<ChartTooltip currency={currency} />} />
              <Area
                type="monotone"
                dataKey="cumulative"
                name="Накопичено"
                stroke={positive ? "#2f7d5f" : "#c2554a"}
                strokeWidth={2}
                fill="url(#savingsFill)"
              />
              <Bar dataKey="net" name="За період" fill="#d8d8d2" radius={[3, 3, 0, 0]} maxBarSize={18} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
