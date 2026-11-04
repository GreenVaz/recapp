import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Plus,
  Wallet,
} from 'lucide-react';
import {
  addMonths,
  monthGrid,
  monthKey,
  parts,
  startOfMonth,
  type DateISO,
} from '@core/dates.ts';
import { formatMoney } from '@core/money.ts';
import { forecast, type ForecastDay, type ForecastEvent } from '@core/forecast.ts';
import { useData } from '@/lib/store.tsx';
import {
  cn,
  formatCellAmount,
  formatDate,
  formatMonthTitle,
  formatRelativeDay,
  WEEKDAYS_SHORT,
} from '@/lib/format.ts';
import { AppHeader } from '@/components/AppHeader.tsx';
import { Card, EmptyState, FullScreenLoader, Segmented } from '@/components/ui.tsx';
import { Sheet } from '@/components/Sheet.tsx';
import { Icon } from '@/components/Icon.tsx';

export function CalendarScreen() {
  const { data, ledger, baseCurrency, rates, today, ensureRange, forecastResult } = useData();
  const navigate = useNavigate();

  const [cursor, setCursor] = useState<DateISO>(() => startOfMonth(today));
  const [accountId, setAccountId] = useState<string>('');
  const [view, setView] = useState<'calendar' | 'list'>('calendar');
  const [selected, setSelected] = useState<DateISO | null>(null);

  const gridDays = useMemo(() => monthGrid(cursor, 1), [cursor]);
  const rangeFrom = gridDays[0]!;
  const rangeTo = gridDays.at(-1)!;

  // Перехід на місяць за межами завантаженого діапазону підтягує дані.
  // Саме в ефекті, а не в тілі рендера: ensureRange оновлює стан провайдера.
  useEffect(() => {
    ensureRange(rangeFrom, rangeTo);
  }, [ensureRange, rangeFrom, rangeTo]);

  /**
   * Фільтр по рахунку змінює саму природу прогнозу (переказ перестає бути
   * нейтральним), тож рушій переганяється наново, а не фільтрується пост-фактум.
   */
  const result = useMemo(() => {
    if (!data || !ledger) return null;
    if (!accountId) return forecastResult;

    return forecast({
      from: ledger.from,
      to: ledger.to,
      today,
      baseCurrency,
      rates,
      accounts: data.accounts.map((a) => ({ id: a.id, currency: a.currency, balance: a.balance })),
      transactions: ledger.transactions,
      rules: ledger.rules,
      exceptions: ledger.exceptions,
      loanDues: ledger.loanDues,
      accountId,
    });
  }, [data, ledger, accountId, forecastResult, baseCurrency, rates, today]);

  if (!data || !result) return <FullScreenLoader />;

  const monthDays = result.days.filter((d) => monthKey(d.date) === monthKey(cursor));
  const monthTotals = monthDays.reduce(
    (acc, day) => ({
      income: acc.income + day.income,
      expense: acc.expense + day.expense + day.loanPayments,
    }),
    { income: 0, expense: 0 },
  );

  const selectedDay = selected ? result.byDate.get(selected) ?? null : null;
  const maxFlow = Math.max(...monthDays.map((d) => Math.max(d.income, d.expense + d.loanPayments)), 1);

  return (
    <main className="page">
      <AppHeader title="Календар" subtitle="Прогноз залишку на кожен день" />

      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          aria-label="Попередній місяць"
          onClick={() => setCursor(addMonths(cursor, -1) ?? cursor)}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-elevated text-ink-soft"
        >
          <ChevronLeft size={18} />
        </button>

        <button
          type="button"
          onClick={() => setCursor(startOfMonth(today))}
          className="flex-1 rounded-xl border border-line bg-elevated py-2 text-sm font-medium"
        >
          {formatMonthTitle(cursor)}
        </button>

        <button
          type="button"
          aria-label="Наступний місяць"
          onClick={() => setCursor(addMonths(cursor, 1) ?? cursor)}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-elevated text-ink-soft"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Wallet size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            aria-label="Рахунок"
            className="field appearance-none py-2.5 pl-8 text-xs"
          >
            <option value="">Усі рахунки</option>
            {data.accounts
              .filter((a) => !a.isArchived)
              .map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
          </select>
        </div>

        <Segmented
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: 'calendar', label: 'Сітка' },
            { value: 'list', label: 'Список' },
          ]}
        />
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <Totals label="Надходження" value={monthTotals.income} currency={baseCurrency} tone="income" />
        <Totals label="Витрати" value={monthTotals.expense} currency={baseCurrency} tone="expense" />
        <Totals
          label="Залишок"
          value={monthDays.at(-1)?.closing ?? 0}
          currency={baseCurrency}
          tone={(monthDays.at(-1)?.closing ?? 0) < 0 ? 'expense' : 'neutral'}
        />
      </div>

      {view === 'calendar' ? (
        <Card className="p-2.5">
          <div className="mb-1 grid grid-cols-7 gap-1">
            {WEEKDAYS_SHORT.map((day) => (
              <div key={day} className="py-1 text-center text-[0.625rem] font-medium text-ink-faint">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {gridDays.map((date) => {
              const day = result.byDate.get(date);
              const outside = monthKey(date) !== monthKey(cursor);
              return (
                <DayCell
                  key={date}
                  date={date}
                  day={day}
                  outside={outside}
                  isToday={date === today}
                  currency={baseCurrency}
                  maxFlow={maxFlow}
                  onSelect={() => setSelected(date)}
                />
              );
            })}
          </div>

          <Legend />
        </Card>
      ) : (
        <Card className="p-0">
          <MonthList days={monthDays} currency={baseCurrency} today={today} onSelect={setSelected} />
        </Card>
      )}

      <DayDetails
        day={selectedDay}
        currency={baseCurrency}
        today={today}
        onClose={() => setSelected(null)}
        onAdd={(date) => {
          setSelected(null);
          navigate(`/new/expense?date=${date}`);
        }}
      />
    </main>
  );
}

function Totals({
  label,
  value,
  currency,
  tone,
}: {
  label: string;
  value: number;
  currency: string;
  tone: 'income' | 'expense' | 'neutral';
}) {
  const toneClass = {
    income: 'text-income',
    expense: 'text-expense',
    neutral: 'text-ink',
  }[tone];

  return (
    <div className="card p-2.5">
      <p className="truncate text-[0.6875rem] text-ink-soft">{label}</p>
      <p className={cn('tnum mt-0.5 text-sm font-semibold', toneClass)}>
        {formatMoney(value, currency, { compact: true, trimCents: true })}
      </p>
    </div>
  );
}

/**
 * Клітинка дня.
 *
 * На екрані 320px осередок має ширину близько 40px, тож числа в нього не
 * влазять. Показуємо день, тонкі смужки пропорцій надходжень і витрат та
 * залишок компактним числом; повні суми — у шторці після дотику.
 */
function DayCell({
  date,
  day,
  outside,
  isToday,
  currency,
  maxFlow,
  onSelect,
}: {
  date: DateISO;
  day: ForecastDay | undefined;
  outside: boolean;
  isToday: boolean;
  currency: string;
  maxFlow: number;
  onSelect: () => void;
}) {
  const income = day?.income ?? 0;
  const outflow = (day?.expense ?? 0) + (day?.loanPayments ?? 0);
  const hasLoan = (day?.loanPayments ?? 0) > 0;
  const deficit = day?.hasDeficit ?? false;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${formatDate(date)}, залишок ${formatMoney(day?.closing ?? 0, currency)}`}
      className={cn(
        'relative flex min-h-[3.25rem] flex-col rounded-lg p-1 text-left transition-colors',
        outside ? 'opacity-35' : '',
        deficit ? 'bg-expense/12' : 'bg-elevated/60',
        isToday && 'ring-1 ring-accent',
      )}
    >
      <span
        className={cn(
          'tnum text-[0.6875rem] font-medium leading-none',
          isToday ? 'text-accent' : 'text-ink-soft',
        )}
      >
        {parts(date).day}
      </span>

      <span className="mt-1 flex h-[3px] gap-[2px]">
        {income > 0 && (
          <span
            className="rounded-full bg-income"
            style={{ width: `${Math.max(18, (income / maxFlow) * 100)}%` }}
          />
        )}
        {outflow > 0 && (
          <span
            className={cn('rounded-full', hasLoan ? 'bg-debt' : 'bg-expense')}
            style={{ width: `${Math.max(18, (outflow / maxFlow) * 100)}%` }}
          />
        )}
      </span>

      {day && (
        <span
          className={cn(
            'tnum mt-auto truncate text-[0.5625rem] leading-tight',
            deficit ? 'font-semibold text-expense' : 'text-ink-faint',
          )}
        >
          {formatCellAmount(day.closing)}
        </span>
      )}
    </button>
  );
}

function Legend() {
  return (
    <div className="mt-2.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-line pt-2.5 text-[0.625rem] text-ink-faint">
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-income" /> дохід
      </span>
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-expense" /> витрата
      </span>
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-debt" /> кредит
      </span>
      <span className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-expense/40" /> дефіцит
      </span>
    </div>
  );
}

function MonthList({
  days,
  currency,
  today,
  onSelect,
}: {
  days: ForecastDay[];
  currency: string;
  today: DateISO;
  onSelect: (date: DateISO) => void;
}) {
  const active = days.filter((d) => d.events.length > 0);

  if (active.length === 0) {
    return (
      <EmptyState
        icon={<CalendarDays size={22} />}
        title="Цього місяця операцій немає"
        description="Додайте витрату, дохід або плановий платіж."
      />
    );
  }

  return (
    <ul className="divide-y divide-line">
      {active.map((day) => (
        <li key={day.date}>
          <button
            type="button"
            onClick={() => onSelect(day.date)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-elevated"
          >
            <div className="w-11 shrink-0">
              <p
                className={cn(
                  'tnum text-base font-semibold leading-none',
                  day.date === today ? 'text-accent' : 'text-ink',
                )}
              >
                {parts(day.date).day}
              </p>
              <p className="mt-0.5 text-[0.625rem] text-ink-faint">
                {WEEKDAYS_SHORT[(new Date(`${day.date}T00:00:00Z`).getUTCDay() + 6) % 7]}
              </p>
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink">
                {day.events
                  .slice(0, 2)
                  .map((e) => e.title || 'Без опису')
                  .join(' · ')}
                {day.events.length > 2 && ` +${day.events.length - 2}`}
              </p>
              <p className="tnum mt-0.5 text-xs text-ink-faint">
                залишок {formatMoney(day.closing, currency, { trimCents: true })}
              </p>
            </div>

            <div className="shrink-0 text-right">
              {day.income > 0 && (
                <p className="tnum text-xs font-medium text-income">
                  +{formatMoney(day.income, currency, { compact: true, trimCents: true })}
                </p>
              )}
              {day.expense + day.loanPayments > 0 && (
                <p className="tnum text-xs font-medium text-expense">
                  −{formatMoney(day.expense + day.loanPayments, currency, { compact: true, trimCents: true })}
                </p>
              )}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function DayDetails({
  day,
  currency,
  today,
  onClose,
  onAdd,
}: {
  day: ForecastDay | null;
  currency: string;
  today: DateISO;
  onClose: () => void;
  onAdd: (date: DateISO) => void;
}) {
  if (!day) return null;

  const groups: Array<{ title: string; items: ForecastEvent[]; tone: string }> = [
    { title: 'Надходження', items: day.events.filter((e) => e.kind === 'income'), tone: 'text-income' },
    {
      title: 'Витрати',
      items: day.events.filter((e) => e.kind === 'expense' || e.kind === 'adjustment'),
      tone: 'text-expense',
    },
    { title: 'Кредити', items: day.events.filter((e) => e.kind === 'loan_payment'), tone: 'text-debt' },
    { title: 'Перекази', items: day.events.filter((e) => e.kind === 'transfer'), tone: 'text-ink-soft' },
  ];

  return (
    <Sheet
      open
      onClose={onClose}
      title={formatDate(day.date, today)}
      description={`${day.isPast ? 'Факт' : 'Прогноз'} · ${formatRelativeDay(day.date, today)}`}
      footer={
        <button type="button" onClick={() => onAdd(day.date)} className="btn-primary w-full">
          <Plus size={17} />
          Додати операцію на цей день
        </button>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-elevated p-3">
          <p className="text-[0.6875rem] text-ink-soft">Початок дня</p>
          <p className="tnum mt-0.5 text-sm font-semibold">{formatMoney(day.opening, currency)}</p>
        </div>
        <div className={cn('rounded-xl p-3', day.hasDeficit ? 'bg-expense/12' : 'bg-accent/10')}>
          <p className="text-[0.6875rem] text-ink-soft">Залишок на кінець</p>
          <p
            className={cn(
              'tnum mt-0.5 text-sm font-semibold',
              day.hasDeficit ? 'text-expense' : 'text-ink',
            )}
          >
            {formatMoney(day.closing, currency)}
          </p>
        </div>
      </div>

      {day.events.length === 0 ? (
        <EmptyState title="Операцій цього дня немає" />
      ) : (
        <div className="space-y-4">
          {groups
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <section key={group.title}>
                <h3 className={cn('mb-1.5 text-xs font-medium', group.tone)}>{group.title}</h3>
                <ul className="space-y-1">
                  {group.items.map((event) => (
                    <EventRow key={event.key} event={event} currency={currency} />
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
    </Sheet>
  );
}

function EventRow({ event, currency }: { event: ForecastEvent; currency: string }) {
  const sourceLabel = {
    transaction: event.isActual ? 'виконано' : 'заплановано',
    recurring: 'регулярна',
    loan: 'графік кредиту',
    scenario: 'сценарій',
  }[event.source];

  const body = (
    <>
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          event.delta > 0 ? 'bg-income/12 text-income' : 'bg-expense/12 text-expense',
        )}
      >
        <Icon
          name={
            event.kind === 'loan_payment'
              ? 'Landmark'
              : event.kind === 'transfer'
                ? 'ArrowLeftRight'
                : event.delta > 0
                  ? 'ArrowDownLeft'
                  : 'ArrowUpRight'
          }
          size={15}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink">{event.title || 'Без опису'}</span>
        <span className="flex items-center gap-1 text-[0.6875rem] text-ink-faint">
          {!event.isActual && <CircleDot size={9} />}
          {sourceLabel}
          {event.isOverdue && <span className="text-debt">· прострочено</span>}
        </span>
      </span>
      <span
        className={cn(
          'tnum shrink-0 text-sm font-medium',
          event.delta > 0 ? 'text-income' : 'text-ink',
        )}
      >
        {formatMoney(event.amount, event.currency || currency, { trimCents: true })}
      </span>
    </>
  );

  // Кредитний платіж веде на свій кредит, решта — у список операцій.
  const href = event.loanId ? `/loans/${event.loanId}` : '/transactions';

  return (
    <li>
      <Link
        to={href}
        className="flex items-center gap-2.5 rounded-xl p-2 transition-colors active:bg-elevated"
      >
        {body}
      </Link>
    </li>
  );
}
