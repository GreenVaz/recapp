import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, Trash2, TriangleAlert, Undo2 } from 'lucide-react';
import { formatMoney, type Minor } from '@core/money.js';
import { api, ApiError } from '@/lib/api.js';
import { useData } from '@/lib/store.js';
import { cn, formatDate, formatRelativeDay, formatShortDate } from '@/lib/format.js';
import { BackHeader } from '@/components/AppHeader.js';
import { Card, ErrorNote, FullScreenLoader, Progress, Segmented } from '@/components/ui.js';
import { Sheet } from '@/components/Sheet.js';
import { AmountInput, DateField, Field, SelectField } from '@/components/fields.js';
import type { LoanBundle } from '@/lib/types.js';
import type { ScheduleRow } from '@core/types.js';

export function LoanDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const { data, today, run } = useData();
  const navigate = useNavigate();

  const [tab, setTab] = useState<'schedule' | 'history'>('schedule');
  const [paying, setPaying] = useState<(ScheduleRow & { id: string }) | null>(null);
  const [extraOpen, setExtraOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bundle = useMemo(() => data?.loans.find((b) => b.loan.id === id) ?? null, [data, id]);

  if (!data) return <FullScreenLoader />;
  if (!bundle) {
    return (
      <main className="page">
        <BackHeader title="Кредит" to="/loans" />
        <Card>
          <p className="text-sm text-ink-soft">Кредит не знайдено.</p>
        </Card>
      </main>
    );
  }

  const { loan, schedule, payments, summary } = bundle;

  async function removeLoan() {
    if (!confirm(`Видалити «${loan.name}» разом із графіком?`)) return;
    try {
      await run(() => api.del(`/api/loans/${loan.id}`));
      navigate('/loans');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не вдалося видалити');
    }
  }

  async function cancelPayment(paymentId: string) {
    if (!confirm('Скасувати платіж? Пов’язана операція теж буде видалена.')) return;
    try {
      await run(() => api.del(`/api/loans/${loan.id}/payments/${paymentId}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не вдалося скасувати');
    }
  }

  return (
    <main className="page">
      <BackHeader title={loan.name} to="/loans" />

      <Card className="mb-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs text-ink-soft">Залишок основного боргу</p>
            <p className="tnum mt-1 text-2xl font-semibold tracking-tight">
              {formatMoney(summary.outstandingPrincipal, loan.currency, { trimCents: true })}
            </p>
          </div>
          <div className="text-right">
            <p className="tnum text-sm font-semibold text-ink">{summary.progressPercent.toFixed(0)}%</p>
            <p className="text-[0.6875rem] text-ink-faint">погашено</p>
          </div>
        </div>

        <Progress className="mt-3" value={summary.progressPercent} tone={summary.isClosed ? 'income' : 'debt'} />

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-3 text-xs">
          <Row label="Початкова сума" value={formatMoney(loan.principal, loan.currency, { trimCents: true })} />
          <Row label="Щомісячний платіж" value={formatMoney(summary.monthlyPayment, loan.currency, { trimCents: true })} />
          <Row
            label="Сплачено тіла"
            value={formatMoney(summary.principalPaid, loan.currency, { trimCents: true })}
          />
          <Row
            label="Сплачено відсотків"
            value={formatMoney(summary.interestPaid, loan.currency, { trimCents: true })}
          />
          <Row
            label="Залишилось платежів"
            value={formatMoney(summary.remainingToPay, loan.currency, { trimCents: true })}
            hint="разом із відсотками"
          />
          <Row
            label="Переплата"
            value={formatMoney(summary.overpayment, loan.currency, { trimCents: true })}
          />
          {summary.nextPayment && (
            <Row
              label="Наступний платіж"
              value={formatShortDate(summary.nextPayment.dueOn)}
              hint={formatRelativeDay(summary.nextPayment.dueOn, today)}
            />
          )}
          {summary.closingDate && (
            <Row label="Дата закриття" value={formatDate(summary.closingDate, today)} />
          )}
        </dl>
      </Card>

      <ErrorNote message={error} />

      {!summary.isClosed && (
        <button type="button" onClick={() => setExtraOpen(true)} className="btn-secondary mb-3 w-full">
          Дострокове погашення
        </button>
      )}

      <Segmented
        value={tab}
        onChange={setTab}
        className="mb-3 w-full"
        options={[
          { value: 'schedule', label: 'Графік' },
          { value: 'history', label: `Виплати (${payments.length})` },
        ]}
      />

      {tab === 'schedule' ? (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {schedule.map((row) => (
              <li key={row.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold',
                    row.status === 'paid'
                      ? 'bg-income/12 text-income'
                      : row.status === 'partial'
                        ? 'bg-debt/12 text-debt'
                        : 'bg-elevated text-ink-faint',
                  )}
                >
                  {row.status === 'paid' ? <Check size={15} /> : row.seq}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="tnum text-sm text-ink">{formatDate(row.dueOn, today)}</p>
                  <p className="tnum text-[0.6875rem] text-ink-faint">
                    тіло {formatMoney(row.principalPart, loan.currency, { trimCents: true })}
                    {row.interestPart > 0 &&
                      ` · відсотки ${formatMoney(row.interestPart, loan.currency, { trimCents: true })}`}
                    {row.feePart > 0 &&
                      ` · комісія ${formatMoney(row.feePart, loan.currency, { trimCents: true })}`}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="tnum text-sm font-medium">
                    {formatMoney(row.amount, loan.currency, { trimCents: true })}
                  </p>
                  {row.status === 'pending' || row.status === 'partial' ? (
                    <button
                      type="button"
                      onClick={() => setPaying(row)}
                      className="mt-0.5 text-[0.6875rem] font-medium text-accent"
                    >
                      Сплатити
                    </button>
                  ) : (
                    <p className="text-[0.6875rem] text-income">сплачено</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card className="p-0">
          {payments.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-soft">Виплат ще не було.</p>
          ) : (
            <ul className="divide-y divide-line">
              {payments.map((payment) => (
                <li key={payment.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="tnum text-sm text-ink">{formatDate(payment.paidOn, today)}</p>
                    <p className="text-[0.6875rem] text-ink-faint">
                      {payment.kind === 'extra'
                        ? 'дострокове'
                        : payment.kind === 'partial'
                          ? 'часткове'
                          : 'за графіком'}
                      {payment.earlyStrategy === 'reduce_term' && ' · скорочення строку'}
                      {payment.earlyStrategy === 'reduce_payment' && ' · зменшення платежу'}
                    </p>
                  </div>
                  <p className="tnum shrink-0 text-sm font-medium">
                    {formatMoney(payment.amount, loan.currency, { trimCents: true })}
                  </p>
                  <button
                    type="button"
                    onClick={() => void cancelPayment(payment.id)}
                    aria-label="Скасувати платіж"
                    className="shrink-0 rounded-lg p-1.5 text-ink-faint transition-colors hover:text-expense"
                  >
                    <Undo2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <button type="button" onClick={removeLoan} className="btn-danger mt-4 w-full">
        <Trash2 size={16} />
        Видалити кредит
      </button>

      {paying && (
        <PaymentSheet
          bundle={bundle}
          row={paying}
          onClose={() => setPaying(null)}
          onDone={() => setPaying(null)}
        />
      )}

      {extraOpen && (
        <PaymentSheet
          bundle={bundle}
          row={null}
          onClose={() => setExtraOpen(false)}
          onDone={() => setExtraOpen(false)}
        />
      )}
    </main>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-ink-soft">{label}</dt>
      <dd className="tnum mt-0.5 font-medium text-ink">{value}</dd>
      {hint && <dd className="text-[0.6875rem] text-ink-faint">{hint}</dd>}
    </div>
  );
}

/** Фіксація планового або дострокового платежу. */
function PaymentSheet({
  bundle,
  row,
  onClose,
  onDone,
}: {
  bundle: LoanBundle;
  row: (ScheduleRow & { id: string }) | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { data, today, run } = useData();
  const { loan } = bundle;

  const [amount, setAmount] = useState<Minor>(row?.amount ?? 0);
  const [paidOn, setPaidOn] = useState(today);
  const [accountId, setAccountId] = useState(loan.accountId ?? data?.accounts[0]?.id ?? '');
  const [strategy, setStrategy] = useState<'reduce_term' | 'reduce_payment'>('reduce_term');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isExtra = row === null;
  const partial = row !== null && amount > 0 && amount < row.amount;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await run(() =>
        api.post(`/api/loans/${loan.id}/payments`, {
          scheduleId: row?.id ?? null,
          paidOn,
          amount,
          accountId: accountId || null,
          kind: isExtra ? 'extra' : partial ? 'partial' : 'scheduled',
          earlyStrategy: isExtra ? strategy : null,
        }),
      );
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не вдалося провести платіж');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={isExtra ? 'Дострокове погашення' : `Платіж №${row.seq}`}
      description={isExtra ? 'Понад графік' : formatDate(row.dueOn, today)}
      footer={
        <button type="button" onClick={submit} disabled={busy || amount <= 0} className="btn-primary w-full">
          {busy ? 'Проводимо…' : 'Провести платіж'}
        </button>
      }
    >
      <div className="space-y-4">
        <AmountInput value={amount} onChange={setAmount} currency={loan.currency} autoFocus />

        {partial && (
          <p className="flex items-start gap-2 rounded-xl bg-debt/10 px-3 py-2 text-xs text-debt">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            Сума менша за платіж у графіку — рядок залишиться частково сплаченим.
          </p>
        )}

        <Field label="Дата">
          <DateField value={paidOn} onChange={setPaidOn} />
        </Field>

        <Field label="Рахунок списання" hint="Операція зменшить баланс цього рахунку">
          <SelectField
            value={accountId}
            onChange={setAccountId}
            options={(data?.accounts ?? [])
              .filter((a) => !a.isArchived)
              .map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }))}
          />
        </Field>

        {isExtra && (
          <Field label="Що зменшуємо" hint="Графік буде перебудовано від наступного платежу">
            <Segmented
              value={strategy}
              onChange={setStrategy}
              className="w-full"
              options={[
                { value: 'reduce_term', label: 'Строк' },
                { value: 'reduce_payment', label: 'Платіж' },
              ]}
            />
          </Field>
        )}

        <ErrorNote message={error} />
      </div>
    </Sheet>
  );
}
