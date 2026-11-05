import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { Landmark, Plus } from 'lucide-react';
import { formatMoney } from '@core/money.js';
import { useData } from '@/lib/store.js';
import { cn, formatDate, formatShortDate, formatRelativeDay, plural } from '@/lib/format.js';
import { AppHeader } from '@/components/AppHeader.js';
import { Card, EmptyState, FullScreenLoader, Progress } from '@/components/ui.js';
import type { LoanBundle } from '@/lib/types.js';

const KIND_LABEL: Record<string, string> = {
  loan: 'Кредит',
  credit_card: 'Кредитна картка',
  installment: 'Розстрочка',
  pay_in_parts: 'Оплата частинами',
  personal: 'Особиста позика',
  interest_free: 'Безвідсотковий борг',
};

export function LoansScreen() {
  const { data, baseCurrency, today, rates } = useData();

  const totals = useMemo(() => {
    if (!data) return { debt: 0, thisMonth: 0, active: 0 };
    const monthPrefix = today.slice(0, 7);

    let debt = 0;
    let thisMonth = 0;
    let active = 0;

    for (const bundle of data.loans) {
      if (bundle.summary.isClosed) continue;
      active += 1;

      // Борги можуть бути в різних валютах — зводимо в базову для підсумку.
      const rate = bundle.loan.currency === baseCurrency ? 1 : (rates[bundle.loan.currency] ?? 0);
      debt += Math.round(bundle.summary.outstandingPrincipal * rate);

      for (const row of bundle.schedule) {
        if (row.status !== 'pending' && row.status !== 'partial') continue;
        if (row.dueOn.slice(0, 7) !== monthPrefix) continue;
        thisMonth += Math.round(row.amount * rate);
      }
    }

    return { debt, thisMonth, active };
  }, [data, baseCurrency, rates, today]);

  if (!data) return <FullScreenLoader />;

  const openLoans = data.loans.filter((b) => !b.summary.isClosed);
  const closedLoans = data.loans.filter((b) => b.summary.isClosed);

  const upcoming = openLoans
    .map((b) => b.summary.nextPayment && { loan: b.loan, row: b.summary.nextPayment })
    .filter((x): x is NonNullable<typeof x> => Boolean(x))
    .sort((a, b) => (a.row.dueOn < b.row.dueOn ? -1 : 1))
    .slice(0, 3);

  return (
    <main className="page">
      <AppHeader title="Кредити" subtitle="Борги, розстрочки та графіки" />

      <div className="mb-3 grid grid-cols-2 gap-2.5">
        <Card className="p-3.5">
          <p className="text-xs text-ink-soft">Загальна заборгованість</p>
          <p className="tnum mt-1 text-xl font-semibold tracking-tight text-debt">
            {formatMoney(totals.debt, baseCurrency, { trimCents: true })}
          </p>
          <p className="mt-0.5 text-[0.6875rem] text-ink-faint">
            {totals.active > 0 ? plural(totals.active, 'активний', 'активні', 'активних') : 'боргів немає'}
          </p>
        </Card>

        <Card className="p-3.5">
          <p className="text-xs text-ink-soft">Платежі цього місяця</p>
          <p className="tnum mt-1 text-xl font-semibold tracking-tight">
            {formatMoney(totals.thisMonth, baseCurrency, { trimCents: true })}
          </p>
          <p className="mt-0.5 text-[0.6875rem] text-ink-faint">за графіками</p>
        </Card>
      </div>

      {upcoming.length > 0 && (
        <Card className="mb-3">
          <h2 className="mb-2 text-sm font-semibold">Найближчі платежі</h2>
          <ul className="divide-y divide-line">
            {upcoming.map(({ loan, row }) => (
              <li key={loan.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{loan.name}</p>
                  <p className="text-xs text-ink-faint">
                    {formatShortDate(row.dueOn)} · {formatRelativeDay(row.dueOn, today)}
                  </p>
                </div>
                <p className="tnum shrink-0 text-sm font-medium">
                  {formatMoney(row.amount, loan.currency, { trimCents: true })}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.loans.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Landmark size={24} />}
            title="Боргів немає"
            description="Додайте кредит або розстрочку — застосунок побудує графік і покаже платежі в календарі."
            action={
              <Link to="/new/loan" className="btn-primary">
                <Plus size={16} />
                Додати кредит
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="space-y-2.5">
          {openLoans.map((bundle) => (
            <LoanCard key={bundle.loan.id} bundle={bundle} today={today} />
          ))}

          {closedLoans.length > 0 && (
            <>
              <h2 className="px-1 pt-2 text-xs font-medium uppercase tracking-wide text-ink-faint">
                Погашені
              </h2>
              {closedLoans.map((bundle) => (
                <LoanCard key={bundle.loan.id} bundle={bundle} today={today} />
              ))}
            </>
          )}
        </div>
      )}
    </main>
  );
}

function LoanCard({ bundle, today }: { bundle: LoanBundle; today: string }) {
  const { loan, summary } = bundle;

  return (
    <Link
      to={`/loans/${loan.id}`}
      className={cn('card block p-4 transition-colors active:bg-elevated', summary.isClosed && 'opacity-60')}
    >
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[0.9375rem] font-medium text-ink">{loan.name}</p>
          <p className="truncate text-xs text-ink-faint">
            {KIND_LABEL[loan.kind] ?? loan.kind}
            {loan.lender ? ` · ${loan.lender}` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="tnum text-base font-semibold text-ink">
            {formatMoney(summary.outstandingPrincipal, loan.currency, { trimCents: true })}
          </p>
          <p className="text-[0.6875rem] text-ink-faint">залишок боргу</p>
        </div>
      </div>

      <Progress value={summary.progressPercent} tone={summary.isClosed ? 'income' : 'debt'} />

      <div className="mt-2 flex items-center justify-between text-xs text-ink-soft">
        <span className="tnum">{summary.progressPercent.toFixed(0)}% погашено</span>
        {summary.isClosed ? (
          <span className="text-income">Закрито</span>
        ) : summary.nextPayment ? (
          <span className="tnum">
            {formatMoney(summary.nextPayment.amount, loan.currency, { trimCents: true })} ·{' '}
            {formatRelativeDay(summary.nextPayment.dueOn, today)}
          </span>
        ) : null}
      </div>

      {!summary.isClosed && summary.closingDate && (
        <p className="mt-1.5 text-[0.6875rem] text-ink-faint">
          Закриється {formatDate(summary.closingDate, today)}
        </p>
      )}
    </Link>
  );
}
