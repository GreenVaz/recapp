import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartPie } from 'lucide-react';
import { addMonths, endOfMonth, monthKey, startOfMonth, type DateISO } from '@core/dates.js';
import { formatMoney } from '@core/money.js';
import { summarize } from '@core/forecast.js';
import { HORIZONS, horizonRange, type HorizonKey } from '@core/forecast.js';
import { useData } from '@/lib/store.js';
import { cn, MONTHS_SHORT, formatShortDate } from '@/lib/format.js';
import { AppHeader } from '@/components/AppHeader.js';
import { Card, EmptyState, FullScreenLoader, SectionTitle, Segmented } from '@/components/ui.js';
import { Icon } from '@/components/Icon.js';

type Period = 'month' | 'prev' | '3m' | '6m' | 'year' | 'custom';

const PERIOD_OPTIONS = [
  { value: 'month' as const, label: 'Місяць' },
  { value: 'prev' as const, label: 'Минулий' },
  { value: '3m' as const, label: '3 міс' },
  { value: '6m' as const, label: '6 міс' },
  { value: 'year' as const, label: 'Рік' },
];

function periodRange(period: Period, today: DateISO): { from: DateISO; to: DateISO } {
  switch (period) {
    case 'prev': {
      const prev = addMonths(today, -1) ?? today;
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    }
    case '3m':
      return { from: startOfMonth(addMonths(today, -2) ?? today), to: endOfMonth(today) };
    case '6m':
      return { from: startOfMonth(addMonths(today, -5) ?? today), to: endOfMonth(today) };
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    default:
      return { from: startOfMonth(today), to: endOfMonth(today) };
  }
}

export function AnalyticsScreen() {
  const { data, forecastResult, baseCurrency, today, ensureRange } = useData();
  const [period, setPeriod] = useState<Period>('month');
  const [customFrom, setCustomFrom] = useState(startOfMonth(today));
  const [customTo, setCustomTo] = useState(endOfMonth(today));
  const [horizon, setHorizon] = useState<HorizonKey>('30d');

  const range = period === 'custom' ? { from: customFrom, to: customTo } : periodRange(period, today);

  const facts = useMemo(() => {
    if (!forecastResult) return null;
    return summarize(forecastResult, range.from, range.to);
  }, [forecastResult, range.from, range.to]);

  const horizonSpan = useMemo(() => horizonRange(today, horizon), [today, horizon]);

  // Довгий горизонт може виходити за межі завантажених даних — підвантажуємо.
  useEffect(() => {
    ensureRange(horizonSpan.from, horizonSpan.to);
  }, [ensureRange, horizonSpan]);

  const forecastSummary = useMemo(
    () => (forecastResult ? summarize(forecastResult, horizonSpan.from, horizonSpan.to) : null),
    [forecastResult, horizonSpan],
  );

  const byCategory = useMemo(() => {
    if (!forecastResult || !data) return [];

    const categoryById = new Map(data.categories.map((c) => [c.id, c]));
    const totals = new Map<string, { name: string; color: string; icon: string; amount: number }>();

    for (const day of forecastResult.days) {
      if (day.date < range.from || day.date > range.to) continue;
      for (const event of day.events) {
        if (event.kind !== 'expense' && event.kind !== 'loan_payment') continue;

        const category = event.categoryId ? categoryById.get(event.categoryId) : null;
        // Деталізацію згортаємо до батьківської категорії — інакше в діаграмі
        // буде 40 секторів по 2%.
        const parent = category?.parentId ? categoryById.get(category.parentId) : category;
        const key = parent?.id ?? (event.kind === 'loan_payment' ? '__loans__' : '__none__');

        const entry = totals.get(key) ?? {
          name: parent?.name ?? (event.kind === 'loan_payment' ? 'Кредити' : 'Без категорії'),
          color: parent?.color ?? (event.kind === 'loan_payment' ? '#e8a33d' : '#8b8f9a'),
          icon: parent?.icon ?? (event.kind === 'loan_payment' ? 'Landmark' : 'CircleHelp'),
          amount: 0,
        };
        entry.amount += Math.abs(event.delta);
        totals.set(key, entry);
      }
    }

    return [...totals.entries()]
      .map(([id, value]) => ({ id, ...value }))
      .sort((a, b) => b.amount - a.amount);
  }, [forecastResult, data, range.from, range.to]);

  const monthlySeries = useMemo(() => {
    if (!forecastResult) return [];
    const buckets = new Map<string, { income: number; expense: number }>();

    for (const day of forecastResult.days) {
      if (day.date < range.from || day.date > range.to) continue;
      const key = monthKey(day.date);
      const bucket = buckets.get(key) ?? { income: 0, expense: 0 };
      bucket.income += day.income;
      bucket.expense += day.expense + day.loanPayments;
      buckets.set(key, bucket);
    }

    return [...buckets.entries()].map(([key, value]) => ({
      key,
      label: MONTHS_SHORT[Number(key.slice(5, 7)) - 1] ?? key,
      ...value,
    }));
  }, [forecastResult, range.from, range.to]);

  const balanceSeries = useMemo(() => {
    if (!forecastResult) return [];
    return forecastResult.days
      .filter((d) => d.date >= range.from && d.date <= range.to)
      .map((d) => ({ date: d.date, label: formatShortDate(d.date), value: d.closing }));
  }, [forecastResult, range.from, range.to]);

  if (!data || !forecastResult || !facts) return <FullScreenLoader />;

  const totalExpense = byCategory.reduce((s, c) => s + c.amount, 0);
  const debtLoad =
    facts.income > 0 ? ((facts.loanPayments / facts.income) * 100).toFixed(0) : null;

  return (
    <main className="page">
      <AppHeader title="Аналітика" subtitle="Факти та прогноз окремо" />

      <div className="no-scrollbar -mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4">
        {PERIOD_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setPeriod(option.value)}
            className={cn(
              'shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors',
              period === option.value ? 'bg-accent text-accent-ink' : 'bg-elevated text-ink-soft',
            )}
          >
            {option.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPeriod('custom')}
          className={cn(
            'shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors',
            period === 'custom' ? 'bg-accent text-accent-ink' : 'bg-elevated text-ink-soft',
          )}
        >
          Свій
        </button>
      </div>

      {period === 'custom' && (
        <Card className="mb-3 flex items-center gap-2 p-3">
          <input
            type="date"
            value={customFrom}
            max={customTo}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="field tnum py-2 text-xs"
            aria-label="Дата з"
          />
          <span className="text-ink-faint">—</span>
          <input
            type="date"
            value={customTo}
            min={customFrom}
            onChange={(e) => setCustomTo(e.target.value)}
            className="field tnum py-2 text-xs"
            aria-label="Дата по"
          />
        </Card>
      )}

      <div className="mb-3 grid grid-cols-3 gap-2">
        <Stat label="Доходи" value={formatMoney(facts.income, baseCurrency, { compact: true })} tone="income" />
        <Stat
          label="Витрати"
          value={formatMoney(facts.expense + facts.loanPayments, baseCurrency, { compact: true })}
          tone="expense"
        />
        <Stat
          label="Потік"
          value={formatMoney(facts.net, baseCurrency, { compact: true, sign: true })}
          tone={facts.net >= 0 ? 'income' : 'expense'}
        />
      </div>

      <Card className="mb-3">
        <SectionTitle title="Структура витрат" hint="За обраний період" />
        {byCategory.length === 0 ? (
          <EmptyState icon={<ChartPie size={22} />} title="Витрат у цьому періоді немає" />
        ) : (
          <div className="flex items-center gap-4">
            <div className="relative h-32 w-32 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={byCategory}
                    dataKey="amount"
                    nameKey="name"
                    innerRadius="62%"
                    outerRadius="100%"
                    paddingAngle={2}
                    stroke="none"
                  >
                    {byCategory.map((entry) => (
                      <Cell key={entry.id} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) =>
                      active && payload?.[0] ? (
                        <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-pop">
                          <p className="text-xs">{String(payload[0].name)}</p>
                          <p className="tnum text-sm font-semibold">
                            {formatMoney(Number(payload[0].value), baseCurrency)}
                          </p>
                        </div>
                      ) : null
                    }
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[0.625rem] text-ink-faint">разом</span>
                <span className="tnum text-xs font-semibold">
                  {formatMoney(totalExpense, baseCurrency, { compact: true, trimCents: true })}
                </span>
              </div>
            </div>

            <ul className="min-w-0 flex-1 space-y-1.5">
              {byCategory.slice(0, 5).map((entry) => (
                <li key={entry.id} className="flex items-center gap-2">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: `${entry.color}22`, color: entry.color }}
                  >
                    <Icon name={entry.icon} size={12} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">{entry.name}</span>
                  <span className="tnum shrink-0 text-xs text-ink-soft">
                    {totalExpense > 0 ? ((entry.amount / totalExpense) * 100).toFixed(0) : 0}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card className="mb-3">
        <SectionTitle title="Доходи та витрати" hint="По місяцях" />
        <div className="-mx-2 h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlySeries} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'rgb(var(--c-ink-faint))', fontSize: 10 }}
              />
              <YAxis hide />
              <Tooltip
                cursor={{ fill: 'rgb(var(--c-elevated))' }}
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-pop">
                      <p className="mb-1 text-[0.6875rem] text-ink-soft">{String(label)}</p>
                      {payload.map((item) => (
                        <p key={String(item.dataKey)} className="tnum text-xs">
                          {item.dataKey === 'income' ? 'Доходи' : 'Витрати'}:{' '}
                          {formatMoney(Number(item.value), baseCurrency, { trimCents: true })}
                        </p>
                      ))}
                    </div>
                  ) : null
                }
              />
              <Bar dataKey="income" fill="rgb(var(--c-income))" radius={[4, 4, 0, 0]} maxBarSize={22} />
              <Bar dataKey="expense" fill="rgb(var(--c-expense))" radius={[4, 4, 0, 0]} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="mb-3">
        <SectionTitle title="Динаміка залишку" hint="Факт до сьогодні, далі прогноз" />
        <div className="-mx-2 h-36">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={balanceSeries} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fill: 'rgb(var(--c-ink-faint))', fontSize: 10 }}
                interval="preserveStartEnd"
                minTickGap={30}
              />
              <YAxis hide domain={['auto', 'auto']} />
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.[0] ? (
                    <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-pop">
                      <p className="tnum text-sm font-semibold">
                        {formatMoney(Number(payload[0].value), baseCurrency)}
                      </p>
                    </div>
                  ) : null
                }
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="rgb(var(--c-accent))"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="mb-3">
        <SectionTitle title="Прогноз" hint="Окремо від фактичних даних" />
        <Segmented
          size="sm"
          value={horizon}
          onChange={setHorizon}
          className="mb-3 w-full"
          options={HORIZONS.map((h) => ({ value: h.key, label: h.label }))}
        />
        {forecastSummary && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
            <Row label="Початковий баланс" value={formatMoney(forecastSummary.openingBalance, baseCurrency, { trimCents: true })} />
            <Row label="Підсумковий баланс" value={formatMoney(forecastSummary.closingBalance, baseCurrency, { trimCents: true })} />
            <Row label="Очікувані доходи" value={formatMoney(forecastSummary.income, baseCurrency, { trimCents: true })} />
            <Row label="Очікувані витрати" value={formatMoney(forecastSummary.expense, baseCurrency, { trimCents: true })} />
            <Row label="Кредитні платежі" value={formatMoney(forecastSummary.loanPayments, baseCurrency, { trimCents: true })} />
            <Row
              label="Мінімальний залишок"
              value={formatMoney(forecastSummary.minBalance, baseCurrency, { trimCents: true })}
              hint={forecastSummary.minBalanceDate ? formatShortDate(forecastSummary.minBalanceDate) : undefined}
              tone={forecastSummary.minBalance < 0 ? 'expense' : undefined}
            />
          </dl>
        )}

        {forecastSummary && forecastSummary.deficitDates.length > 0 && (
          <p className="mt-3 rounded-xl bg-expense/10 px-3 py-2 text-xs text-expense">
            Дефіцит очікується {forecastSummary.deficitDates.length === 1 ? 'у день' : 'у дні'}:{' '}
            {forecastSummary.deficitDates.slice(0, 4).map(formatShortDate).join(', ')}
            {forecastSummary.deficitDates.length > 4 && ` і ще ${forecastSummary.deficitDates.length - 4}`}
          </p>
        )}

        {forecastSummary && forecastSummary.biggestExpenses.length > 0 && (
          <div className="mt-3 border-t border-line pt-3">
            <p className="mb-2 text-xs font-medium text-ink-soft">Найбільші майбутні витрати</p>
            <ul className="space-y-1">
              {forecastSummary.biggestExpenses.map((event) => (
                <li key={event.key} className="flex items-center gap-2 text-xs">
                  <span className="min-w-0 flex-1 truncate text-ink">{event.title || 'Без опису'}</span>
                  <span className="shrink-0 text-ink-faint">{formatShortDate(event.date)}</span>
                  <span className="tnum shrink-0 font-medium text-ink">
                    {formatMoney(Math.abs(event.delta), baseCurrency, { trimCents: true })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle title="Боргове навантаження" />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
          <Row
            label="Платежі по кредитах"
            value={formatMoney(facts.loanPayments, baseCurrency, { trimCents: true })}
            hint="за обраний період"
          />
          <Row
            label="Частка від доходів"
            value={debtLoad === null ? '—' : `${debtLoad}%`}
            tone={debtLoad !== null && Number(debtLoad) > 40 ? 'expense' : undefined}
          />
          <Row
            label="Норма заощадження"
            value={`${facts.savingsRate.toFixed(0)}%`}
            tone={facts.savingsRate < 0 ? 'expense' : undefined}
          />
          <Row
            label="Активних боргів"
            value={String(data.loans.filter((l) => !l.summary.isClosed).length)}
          />
        </dl>
      </Card>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'income' | 'expense' }) {
  return (
    <div className="card p-3">
      <p className="truncate text-[0.6875rem] text-ink-soft">{label}</p>
      <p
        className={cn(
          'tnum mt-0.5 text-sm font-semibold',
          tone === 'income' ? 'text-income' : 'text-expense',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'expense';
}) {
  return (
    <div>
      <dt className="text-ink-soft">{label}</dt>
      <dd className={cn('tnum mt-0.5 font-medium', tone === 'expense' ? 'text-expense' : 'text-ink')}>
        {value}
      </dd>
      {hint && <dd className="text-[0.6875rem] text-ink-faint">{hint}</dd>}
    </div>
  );
}
