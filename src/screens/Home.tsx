import { Link } from 'react-router-dom';
import { lazy, Suspense, useMemo } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Landmark,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { addMonths, endOfMonth, startOfMonth } from '@core/dates.ts';
import { formatMoney } from '@core/money.ts';
import { nextIncome, overdueEvents, summarize, upcomingPayments } from '@core/forecast.ts';
import { useData } from '@/lib/store.tsx';
import { cn, formatRelativeDay, formatShortDate, plural } from '@/lib/format.ts';
import { AppHeader } from '@/components/AppHeader.tsx';
import { Card, EmptyState, FullScreenLoader, SectionTitle } from '@/components/ui.tsx';
import { Icon } from '@/components/Icon.tsx';

const BalanceChart = lazy(() => import('@/components/BalanceChart.tsx'));

export function HomeScreen() {
  const { data, forecastResult, baseCurrency, today } = useData();

  const monthEnd = useMemo(() => endOfMonth(today), [today]);
  const monthStart = useMemo(() => startOfMonth(today), [today]);

  const summary = useMemo(
    () => (forecastResult ? summarize(forecastResult, today, monthEnd) : null),
    [forecastResult, today, monthEnd],
  );

  const chartData = useMemo(() => {
    if (!forecastResult) return [];
    const to = endOfMonth(addMonths(today, 2) ?? today);
    return forecastResult.days
      .filter((d) => d.date >= monthStart && d.date <= to)
      .map((d) => ({ date: d.date, label: formatShortDate(d.date), value: d.closing }));
  }, [forecastResult, monthStart, today]);

  if (!data || !forecastResult || !summary) return <FullScreenLoader />;

  const totalDebt = data.loans
    .filter((bundle) => !bundle.summary.isClosed)
    .reduce((sum, bundle) => sum + bundle.summary.outstandingPrincipal, 0);

  const salary = nextIncome(forecastResult, today);
  const upcoming = upcomingPayments(forecastResult, today, 4);
  const overdue = overdueEvents(forecastResult);
  const deficits = summarize(forecastResult, today, forecastResult.days.at(-1)?.date ?? today).deficitDates;

  return (
    <main className="page">
      <AppHeader
        title="Фінанси"
        subtitle={data.displayName ? `Вітаємо, ${data.displayName}` : undefined}
      />

      {/* ① Поточний баланс і ② прогноз на кінець місяця */}
      <Card className="mb-3 bg-gradient-to-br from-accent/12 to-transparent">
        <p className="text-xs text-ink-soft">Зараз на рахунках</p>
        <p className="tnum mt-1 text-[2rem] font-semibold leading-none tracking-tight">
          {formatMoney(forecastResult.currentBalance, baseCurrency, { trimCents: true })}
        </p>

        <div className="mt-4 flex items-end justify-between gap-3 border-t border-line pt-3">
          <div>
            <p className="text-xs text-ink-soft">Прогноз на кінець місяця</p>
            <p
              className={cn(
                'tnum mt-0.5 text-lg font-semibold',
                summary.closingBalance < 0 ? 'text-expense' : 'text-ink',
              )}
            >
              {formatMoney(summary.closingBalance, baseCurrency, { trimCents: true })}
            </p>
          </div>
          <Link to="/calendar" className="btn-ghost -mr-2 text-xs">
            Календар
            <ArrowRight size={14} />
          </Link>
        </div>

        {forecastResult.missingRates.length > 0 && (
          <p className="mt-3 rounded-lg bg-debt/12 px-2.5 py-1.5 text-[0.6875rem] text-debt">
            Немає курсу для {forecastResult.missingRates.join(', ')} — ці суми не враховані.{' '}
            <Link to="/settings" className="underline">
              Задати курс
            </Link>
          </p>
        )}
      </Card>

      {/* ⑨ Попередження про дефіцит */}
      {deficits.length > 0 && (
        <Link
          to="/calendar"
          className="mb-3 flex items-start gap-3 rounded-2xl border border-expense/30 bg-expense/10 p-3.5"
        >
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-expense" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-expense">
              Грошей не вистачить {formatShortDate(deficits[0]!)}
            </p>
            <p className="mt-0.5 text-xs text-ink-soft">
              {deficits.length === 1
                ? 'Один день із від’ємним залишком у прогнозі'
                : `${plural(deficits.length, 'день', 'дні', 'днів')} із від’ємним залишком`}
            </p>
          </div>
        </Link>
      )}

      {overdue.length > 0 && (
        <Link
          to="/calendar"
          className="mb-3 flex items-start gap-3 rounded-2xl border border-debt/30 bg-debt/10 p-3.5"
        >
          <CalendarClock size={18} className="mt-0.5 shrink-0 text-debt" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-debt">
              {plural(overdue.length, 'прострочений платіж', 'прострочені платежі', 'прострочених платежів')}
            </p>
            <p className="mt-0.5 truncate text-xs text-ink-soft">
              {overdue[0]!.title || 'Без опису'} · {formatShortDate(overdue[0]!.date)}
            </p>
          </div>
        </Link>
      )}

      {/* «До наступної зарплати…» */}
      {salary && (
        <Card className="mb-3">
          <p className="text-sm leading-relaxed text-ink">
            До наступного надходження{' '}
            <span className="font-semibold">{plural(salary.daysUntil, 'день', 'дні', 'днів')}</span>.
            Заплановані платежі —{' '}
            <span className="tnum font-semibold">
              {formatMoney(salary.plannedOutflow, baseCurrency, { trimCents: true })}
            </span>
            . Залишок напередодні —{' '}
            <span
              className={cn('tnum font-semibold', salary.willHoldOut ? 'text-income' : 'text-expense')}
            >
              {formatMoney(salary.balanceBefore, baseCurrency, { trimCents: true })}
            </span>
            .
          </p>
          {!salary.willHoldOut && (
            <p className="mt-2 text-xs text-expense">
              До надходження грошей не вистачить — перенесіть частину платежів.
            </p>
          )}
        </Card>
      )}

      {/* ③④⑥⑦ Ключові показники */}
      <div className="mb-3 grid grid-cols-2 gap-2.5">
        <Metric
          label="Очікувані доходи"
          value={formatMoney(summary.income, baseCurrency, { compact: true })}
          icon={<TrendingUp size={15} />}
          tone="income"
          hint="до кінця місяця"
        />
        <Metric
          label="Заплановані витрати"
          value={formatMoney(summary.expense + summary.loanPayments, baseCurrency, { compact: true })}
          icon={<TrendingDown size={15} />}
          tone="expense"
          hint="разом із кредитами"
        />
        <Metric
          label="Загальний борг"
          value={formatMoney(totalDebt, baseCurrency, { compact: true })}
          icon={<Landmark size={15} />}
          tone="debt"
          hint={
            data.loans.filter((l) => !l.summary.isClosed).length > 0
              ? `${data.loans.filter((l) => !l.summary.isClosed).length} активних`
              : 'немає боргів'
          }
          to="/loans"
        />
        <Metric
          label="Мінімальний залишок"
          value={formatMoney(summary.minBalance, baseCurrency, { compact: true })}
          icon={<AlertTriangle size={15} />}
          tone={summary.minBalance < 0 ? 'expense' : 'accent'}
          hint={summary.minBalanceDate ? formatShortDate(summary.minBalanceDate) : 'цього місяця'}
        />
      </div>

      {/* ⑧ Графік руху грошей */}
      <Card className="mb-3">
        <SectionTitle title="Залишок на рахунках" hint="Прогноз на три місяці вперед" />
        <div className="-mx-2 h-44">
          <Suspense fallback={<div className="h-full animate-pulse rounded-xl bg-elevated" />}>
            <BalanceChart data={chartData} currency={baseCurrency} />
          </Suspense>
        </div>
      </Card>

      {/* ⑤ Найближчі обов'язкові платежі */}
      <Card>
        <SectionTitle
          title="Найближчі платежі"
          action={
            <Link to="/transactions" className="text-xs text-accent">
              Усі операції
            </Link>
          }
        />
        {upcoming.length === 0 ? (
          <EmptyState title="Платежів попереду немає" description="Додайте планову операцію або кредит." />
        ) : (
          <ul className="divide-y divide-line">
            {upcoming.map((event) => (
              <li key={event.key} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                    event.kind === 'loan_payment' ? 'bg-debt/12 text-debt' : 'bg-expense/12 text-expense',
                  )}
                >
                  <Icon name={event.kind === 'loan_payment' ? 'Landmark' : 'ArrowDown'} size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{event.title || 'Без опису'}</p>
                  <p className="text-xs text-ink-faint">
                    {formatShortDate(event.date)} · {formatRelativeDay(event.date, today)}
                  </p>
                </div>
                <p className="tnum shrink-0 text-sm font-medium text-ink">
                  {formatMoney(event.amount, event.currency, { trimCents: true })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}

function Metric({
  label,
  value,
  hint,
  icon,
  tone,
  to,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  tone: 'income' | 'expense' | 'debt' | 'accent';
  to?: string;
}) {
  const toneClass = {
    income: 'text-income',
    expense: 'text-expense',
    debt: 'text-debt',
    accent: 'text-accent',
  }[tone];

  const body = (
    <>
      <div className="mb-1.5 flex items-center justify-between gap-1.5">
        <p className="truncate text-xs text-ink-soft">{label}</p>
        <span className={cn("shrink-0", toneClass)}>{icon}</span>
      </div>
      <p className={cn('tnum text-lg font-semibold tracking-tight', toneClass)}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-[0.6875rem] text-ink-faint">{hint}</p>}
    </>
  );

  return to ? (
    <Link to={to} className="card p-3.5 transition-colors active:bg-elevated">
      {body}
    </Link>
  ) : (
    <div className="card p-3.5">{body}</div>
  );
}
