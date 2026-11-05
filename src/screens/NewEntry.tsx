import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { formatMoney, type Minor } from '@core/money.js';
import { addMonths, today as todayISO } from '@core/dates.js';
import { buildSchedule, type ScheduleSpec } from '@core/loans.js';
import { api, ApiError } from '@/lib/api.js';
import { useData } from '@/lib/store.js';
import { BackHeader } from '@/components/AppHeader.js';
import { Card, ErrorNote, FullScreenLoader, Segmented } from '@/components/ui.js';
import {
  AccountPicker,
  AmountInput,
  CategoryPicker,
  DateField,
  Field,
  NumberField,
  SelectField,
  TextField,
} from '@/components/fields.js';

type Kind = 'expense' | 'income' | 'transfer' | 'adjust' | 'recurring' | 'loan';

const TITLES: Record<Kind, string> = {
  expense: 'Нова витрата',
  income: 'Новий дохід',
  transfer: 'Переказ між рахунками',
  adjust: 'Коригування балансу',
  recurring: 'Планова операція',
  loan: 'Кредит або розстрочка',
};

export function NewEntryScreen() {
  const { kind } = useParams<{ kind: Kind }>();
  const { data } = useData();

  if (!data) return <FullScreenLoader />;
  const safeKind = (kind && kind in TITLES ? kind : 'expense') as Kind;

  return (
    <main className="page">
      <BackHeader title={TITLES[safeKind]} to="/" />
      {safeKind === 'loan' ? (
        <LoanForm />
      ) : safeKind === 'recurring' ? (
        <RecurringForm />
      ) : (
        <TransactionForm kind={safeKind} />
      )}
    </main>
  );
}

// ─── Разова операція ────────────────────────────────────────────────────

function TransactionForm({ kind }: { kind: 'expense' | 'income' | 'transfer' | 'adjust' }) {
  const { data, run, today } = useData();
  const navigate = useNavigate();
  const [search] = useSearchParams();

  const accounts = (data?.accounts ?? []).filter((a) => !a.isArchived);
  const [amount, setAmount] = useState<Minor>(0);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [toAccountId, setToAccountId] = useState(accounts[1]?.id ?? '');
  const [counterAmount, setCounterAmount] = useState<Minor>(0);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [date, setDate] = useState(search.get('date') ?? today);
  const [note, setNote] = useState('');
  const [planned, setPlanned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const account = accounts.find((a) => a.id === accountId);
  const target = accounts.find((a) => a.id === toAccountId);
  const crossCurrency = kind === 'transfer' && account && target && account.currency !== target.currency;

  // Для коригування показуємо, у що перетвориться баланс.
  const adjustDelta = kind === 'adjust' && account ? amount - account.balance : 0;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      if (kind === 'adjust') {
        await run(() =>
          api.post(`/api/accounts/${accountId}/adjust`, {
            targetBalance: amount,
            occurredOn: date,
            note: note || undefined,
          }),
        );
      } else {
        await run(() =>
          api.post('/api/transactions', {
            kind,
            accountId,
            amount,
            occurredOn: date,
            status: planned ? 'planned' : 'posted',
            note: note || null,
            ...(kind === 'transfer'
              ? {
                  counterAccountId: toAccountId,
                  ...(crossCurrency ? { counterAmount } : {}),
                }
              : { categoryId }),
          }),
        );
      }
      navigate(-1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не вдалося зберегти');
    } finally {
      setBusy(false);
    }
  }

  if (accounts.length === 0) {
    return (
      <Card>
        <p className="text-sm text-ink-soft">
          Спершу створіть рахунок у налаштуваннях — операції потрібно кудись записувати.
        </p>
      </Card>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <AmountInput
        value={amount}
        onChange={setAmount}
        currency={account?.currency ?? 'UAH'}
        autoFocus
        placeholder={kind === 'adjust' ? 'Фактичний залишок' : '0'}
      />

      {kind === 'adjust' && account && (
        <p className="rounded-xl bg-elevated px-3 py-2 text-xs text-ink-soft">
          Зараз на рахунку{' '}
          <span className="tnum font-medium text-ink">
            {formatMoney(account.balance, account.currency)}
          </span>
          {adjustDelta !== 0 && (
            <>
              . Буде створено коригування на{' '}
              <span className="tnum font-medium text-ink">
                {formatMoney(adjustDelta, account.currency, { sign: true })}
              </span>
            </>
          )}
        </p>
      )}

      <Field label={kind === 'transfer' ? 'З рахунку' : 'Рахунок'}>
        <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} />
      </Field>

      {kind === 'transfer' && (
        <>
          <Field label="На рахунок">
            <AccountPicker
              accounts={accounts}
              value={toAccountId}
              onChange={setToAccountId}
              exclude={accountId}
            />
          </Field>

          {crossCurrency && (
            <Field
              label={`Сума зарахування (${target.currency})`}
              hint="Валюти різні — вкажіть, скільки фактично надійде"
            >
              <AmountInput
                value={counterAmount}
                onChange={setCounterAmount}
                currency={target.currency}
              />
            </Field>
          )}
        </>
      )}

      {(kind === 'expense' || kind === 'income') && data && (
        <Field label="Категорія">
          <CategoryPicker
            categories={data.categories}
            kind={kind}
            value={categoryId}
            onChange={setCategoryId}
          />
        </Field>
      )}

      <Field label="Дата">
        <DateField value={date} onChange={setDate} />
      </Field>

      <Field label="Коментар">
        <TextField value={note} onChange={setNote} placeholder="Необов’язково" />
      </Field>

      {kind !== 'adjust' && (
        <label className="flex items-center justify-between rounded-xl border border-line bg-elevated px-3.5 py-3">
          <span className="min-w-0">
            <span className="block text-sm text-ink">Ще не виконано</span>
            <span className="block text-xs text-ink-faint">
              Потрапить у прогноз, але не змінить поточний баланс
            </span>
          </span>
          <input
            type="checkbox"
            checked={planned}
            onChange={(e) => setPlanned(e.target.checked)}
            className="h-5 w-5 shrink-0 accent-[rgb(var(--c-accent))]"
          />
        </label>
      )}

      <ErrorNote message={error} />

      <button type="submit" disabled={busy || amount === 0} className="btn-primary w-full">
        {busy ? 'Зберігаємо…' : 'Зберегти'}
      </button>
    </form>
  );
}

// ─── Регулярна операція ─────────────────────────────────────────────────

function RecurringForm() {
  const { data, run, today } = useData();
  const navigate = useNavigate();

  const accounts = (data?.accounts ?? []).filter((a) => !a.isArchived);
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [amount, setAmount] = useState<Minor>(0);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [freq, setFreq] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
  const [anchorDate, setAnchorDate] = useState(today);
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');
  const [monthEndPolicy, setMonthEndPolicy] = useState<'clamp' | 'skip'>('clamp');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const account = accounts.find((a) => a.id === accountId);
  const dayOfMonth = Number(anchorDate.slice(8, 10));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await run(() =>
        api.post('/api/recurring', {
          kind,
          accountId,
          categoryId,
          amount,
          freq,
          anchorDate,
          endDate: endDate || null,
          monthEndPolicy,
          note: note || null,
        }),
      );
      navigate('/calendar');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не вдалося зберегти');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Segmented
        value={kind}
        onChange={(next) => {
          setKind(next);
          setCategoryId(null);
        }}
        className="w-full"
        options={[
          { value: 'expense', label: 'Витрата' },
          { value: 'income', label: 'Дохід' },
        ]}
      />

      <AmountInput value={amount} onChange={setAmount} currency={account?.currency ?? 'UAH'} autoFocus />

      <Field label="Назва" hint="Наприклад: Оренда квартири або Зарплата">
        <TextField value={note} onChange={setNote} placeholder="Назва платежу" />
      </Field>

      <Field label="Рахунок">
        <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} />
      </Field>

      {data && (
        <Field label="Категорія">
          <CategoryPicker categories={data.categories} kind={kind} value={categoryId} onChange={setCategoryId} />
        </Field>
      )}

      <Field label="Періодичність">
        <SelectField
          value={freq}
          onChange={setFreq}
          options={[
            { value: 'daily' as const, label: 'Щодня' },
            { value: 'weekly' as const, label: 'Щотижня' },
            { value: 'monthly' as const, label: 'Щомісяця' },
            { value: 'yearly' as const, label: 'Щороку' },
          ]}
        />
      </Field>

      <Field label="Перший платіж">
        <DateField value={anchorDate} onChange={setAnchorDate} />
      </Field>

      {freq === 'monthly' && dayOfMonth > 28 && (
        <Field
          label={`У місяцях, де немає ${dayOfMonth} числа`}
          hint="Лютий коротший за інші місяці — потрібно вирішити, що робити"
        >
          <Segmented
            value={monthEndPolicy}
            onChange={setMonthEndPolicy}
            className="w-full"
            options={[
              { value: 'clamp', label: 'Останній день' },
              { value: 'skip', label: 'Пропустити' },
            ]}
          />
        </Field>
      )}

      <Field label="Завершити серію" hint="Залиште порожнім, якщо платіж безстроковий">
        <DateField value={endDate} onChange={setEndDate} min={anchorDate} />
      </Field>

      <ErrorNote message={error} />

      <button type="submit" disabled={busy || amount === 0} className="btn-primary w-full">
        {busy ? 'Зберігаємо…' : 'Створити розклад'}
      </button>
    </form>
  );
}

// ─── Кредит і розстрочка ────────────────────────────────────────────────

function LoanForm() {
  const { data, run, today } = useData();
  const navigate = useNavigate();

  const accounts = (data?.accounts ?? []).filter((a) => !a.isArchived);
  const [name, setName] = useState('');
  const [lender, setLender] = useState('');
  const [kind, setKind] = useState<'installment' | 'loan' | 'credit_card' | 'personal'>('installment');
  const [scheduleType, setScheduleType] = useState<
    'interest_free' | 'annuity' | 'differentiated' | 'fixed_equal'
  >('interest_free');
  const [principal, setPrincipal] = useState<Minor>(0);
  const [totalDue, setTotalDue] = useState<Minor>(0);
  const [paymentsCount, setPaymentsCount] = useState<number | null>(8);
  const [rate, setRate] = useState<number | null>(null);
  const [ratePeriod, setRatePeriod] = useState<'annual' | 'monthly'>('annual');
  const [firstPaymentOn, setFirstPaymentOn] = useState(() => addMonths(todayISO(), 1) ?? todayISO());
  const [currency, setCurrency] = useState('UAH');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsRate = scheduleType === 'annuity' || scheduleType === 'differentiated';
  const needsTotal = scheduleType === 'fixed_equal';

  /** Попередній перегляд графіка рахується тим самим рушієм, що й на сервері. */
  const preview = useMemo(() => {
    if (principal <= 0 || !paymentsCount || paymentsCount <= 0) return null;
    if (needsRate && (rate === null || rate < 0)) return null;
    if (needsTotal && totalDue < principal) return null;

    const spec: ScheduleSpec = {
      principal,
      rateAnnual: rate === null ? null : ratePeriod === 'monthly' ? rate * 12 : rate,
      scheduleType,
      paymentsCount,
      firstPaymentOn,
      totalDue: needsTotal ? totalDue : null,
    };

    try {
      const rows = buildSchedule(spec);
      return {
        rows,
        monthly: rows[0]?.amount ?? 0,
        total: rows.reduce((s, r) => s + r.amount, 0),
        last: rows.at(-1)?.dueOn ?? null,
      };
    } catch {
      return null;
    }
  }, [principal, paymentsCount, rate, ratePeriod, scheduleType, firstPaymentOn, totalDue, needsRate, needsTotal]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await run(() =>
        api.post<{ loan: { id: string } }>('/api/loans', {
          name: name.trim() || 'Кредит',
          lender: lender.trim() || null,
          kind,
          principal,
          currency,
          openedOn: today,
          scheduleType,
          paymentsCount,
          firstPaymentOn,
          accountId: accountId || null,
          ...(needsRate ? { rateInput: rate, ratePeriod } : {}),
          ...(needsTotal ? { totalDue } : {}),
        }),
      );
      navigate(`/loans/${created.loan.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не вдалося створити кредит');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Назва">
        <TextField value={name} onChange={setName} placeholder="Телефон у розстрочку" />
      </Field>

      <Field label="Тип">
        <SelectField
          value={kind}
          onChange={setKind}
          options={[
            { value: 'installment' as const, label: 'Розстрочка' },
            { value: 'loan' as const, label: 'Кредит' },
            { value: 'credit_card' as const, label: 'Кредитна картка' },
            { value: 'personal' as const, label: 'Особиста позика' },
          ]}
        />
      </Field>

      <Field label="Сума">
        <AmountInput value={principal} onChange={setPrincipal} currency={currency} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Валюта">
          <SelectField
            value={currency}
            onChange={setCurrency}
            options={[
              { value: 'UAH', label: 'UAH' },
              { value: 'USD', label: 'USD' },
              { value: 'EUR', label: 'EUR' },
            ]}
          />
        </Field>
        <Field label="Кількість платежів">
          <NumberField value={paymentsCount} onChange={setPaymentsCount} min={1} max={600} />
        </Field>
      </div>

      <Field label="Тип графіка" hint="Що саме рахувати">
        <SelectField
          value={scheduleType}
          onChange={setScheduleType}
          options={[
            { value: 'interest_free' as const, label: 'Без відсотків — рівні частки' },
            { value: 'fixed_equal' as const, label: 'Відома лише загальна сума' },
            { value: 'annuity' as const, label: 'Ануїтет — однаковий платіж' },
            { value: 'differentiated' as const, label: 'Диференційований — спадний платіж' },
          ]}
        />
      </Field>

      {needsRate && (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ставка">
            <NumberField value={rate} onChange={setRate} min={0} max={1000} step={0.01} suffix="%" />
          </Field>
          <Field label="Період ставки">
            <SelectField
              value={ratePeriod}
              onChange={setRatePeriod}
              options={[
                { value: 'annual' as const, label: 'Річна' },
                { value: 'monthly' as const, label: 'Місячна' },
              ]}
            />
          </Field>
        </div>
      )}

      {needsTotal && (
        <Field
          label="Загальна сума до виплати"
          hint="Якщо умови невідомі — візьміть суму з договору"
        >
          <AmountInput value={totalDue} onChange={setTotalDue} currency={currency} />
        </Field>
      )}

      <Field label="Перший платіж">
        <DateField value={firstPaymentOn} onChange={setFirstPaymentOn} />
      </Field>

      <Field label="Кредитор">
        <TextField value={lender} onChange={setLender} placeholder="Необов’язково" />
      </Field>

      {accounts.length > 0 && (
        <Field label="Рахунок списання">
          <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} />
        </Field>
      )}

      {preview && (
        <Card className="bg-accent/8">
          <p className="mb-2 text-xs font-medium text-ink-soft">Попередній розрахунок</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div>
              <dt className="text-ink-soft">Платіж</dt>
              <dd className="tnum font-semibold text-ink">
                {formatMoney(preview.monthly, currency, { trimCents: true })}
              </dd>
            </div>
            <div>
              <dt className="text-ink-soft">Разом до виплати</dt>
              <dd className="tnum font-semibold text-ink">
                {formatMoney(preview.total, currency, { trimCents: true })}
              </dd>
            </div>
            <div>
              <dt className="text-ink-soft">Переплата</dt>
              <dd className="tnum font-semibold text-ink">
                {formatMoney(Math.max(0, preview.total - principal), currency, { trimCents: true })}
              </dd>
            </div>
            <div>
              <dt className="text-ink-soft">Останній платіж</dt>
              <dd className="tnum font-semibold text-ink">{preview.last ?? '—'}</dd>
            </div>
          </dl>
        </Card>
      )}

      <ErrorNote message={error} />

      <button type="submit" disabled={busy || principal <= 0 || !preview} className="btn-primary w-full">
        {busy ? 'Створюємо…' : 'Створити графік'}
      </button>
    </form>
  );
}
