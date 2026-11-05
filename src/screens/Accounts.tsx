import { useState } from 'react';
import { Archive, ArchiveRestore, Pencil, Plus, Scale, Trash2, Wallet } from 'lucide-react';
import { formatMoney, type Minor } from '@core/money.js';
import { api, ApiError } from '@/lib/api.js';
import { useData } from '@/lib/store.js';
import { cn } from '@/lib/format.js';
import { BackHeader } from '@/components/AppHeader.js';
import { Card, EmptyState, ErrorNote, FullScreenLoader } from '@/components/ui.js';
import { Sheet } from '@/components/Sheet.js';
import { AmountInput, Field, SelectField, TextField } from '@/components/fields.js';
import { COLOR_CHOICES, Icon, ICON_CHOICES } from '@/components/Icon.js';
import type { Account } from '@core/types.js';

const TYPE_LABEL: Record<string, string> = {
  card: 'Банківська картка',
  bank: 'Банківський рахунок',
  cash: 'Готівка',
  savings: 'Ощадний рахунок',
  other: 'Інше',
};

export function AccountsScreen() {
  const { data, run } = useData();
  const [editing, setEditing] = useState<Account | null>(null);
  const [creating, setCreating] = useState(false);
  const [adjusting, setAdjusting] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!data) return <FullScreenLoader />;

  const active = data.accounts.filter((a) => !a.isArchived);
  const archived = data.accounts.filter((a) => a.isArchived);

  // Валюти не змішуємо в один підсумок — це була б неправда.
  const byCurrency = active.reduce<Record<string, number>>((acc, account) => {
    acc[account.currency] = (acc[account.currency] ?? 0) + account.balance;
    return acc;
  }, {});

  async function toggleArchive(account: Account) {
    try {
      await run(() => api.patch(`/api/accounts/${account.id}`, { isArchived: !account.isArchived }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не вдалося змінити');
    }
  }

  async function remove(account: Account) {
    try {
      await run(() => api.del(`/api/accounts/${account.id}`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        if (!confirm(`${e.message}\n\nВидалити разом з історією?`)) return;
        try {
          await run(() => api.del(`/api/accounts/${account.id}?force=true`));
          return;
        } catch (inner) {
          setError(inner instanceof ApiError ? inner.message : 'Не вдалося видалити');
          return;
        }
      }
      setError(e instanceof ApiError ? e.message : 'Не вдалося видалити');
    }
  }

  return (
    <main className="page">
      <BackHeader title="Рахунки" />

      {Object.keys(byCurrency).length > 0 && (
        <div className="no-scrollbar -mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
          {Object.entries(byCurrency).map(([currency, total]) => (
            <div key={currency} className="card shrink-0 px-3.5 py-2.5">
              <p className="text-[0.6875rem] text-ink-soft">Разом {currency}</p>
              <p className="tnum text-base font-semibold">{formatMoney(total, currency, { trimCents: true })}</p>
            </div>
          ))}
        </div>
      )}

      <ErrorNote message={error} />

      {active.length === 0 ? (
        <Card>
          <EmptyState icon={<Wallet size={22} />} title="Рахунків немає" description="Створіть перший рахунок." />
        </Card>
      ) : (
        <ul className="space-y-2">
          {[...active, ...archived].map((account) => (
            <li key={account.id}>
              <Card className={cn('p-3.5', account.isArchived && 'opacity-55')}>
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: `${account.color}22`, color: account.color }}
                  >
                    <Icon name={account.icon} size={18} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[0.9375rem] font-medium">{account.name}</p>
                    <p className="truncate text-xs text-ink-faint">
                      {TYPE_LABEL[account.type] ?? account.type} · {account.currency}
                      {account.isArchived && ' · в архіві'}
                    </p>
                  </div>

                  <p className="tnum shrink-0 text-base font-semibold">
                    {formatMoney(account.balance, account.currency, { trimCents: true })}
                  </p>
                </div>

                <div className="mt-2.5 flex gap-1 border-t border-line pt-2.5">
                  <IconAction label="Коригувати" onClick={() => setAdjusting(account)}>
                    <Scale size={15} />
                  </IconAction>
                  <IconAction label="Редагувати" onClick={() => setEditing(account)}>
                    <Pencil size={15} />
                  </IconAction>
                  <IconAction
                    label={account.isArchived ? 'Повернути' : 'В архів'}
                    onClick={() => void toggleArchive(account)}
                  >
                    {account.isArchived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                  </IconAction>
                  <IconAction label="Видалити" danger onClick={() => void remove(account)}>
                    <Trash2 size={15} />
                  </IconAction>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={() => setCreating(true)} className="btn-primary mt-4 w-full">
        <Plus size={17} />
        Новий рахунок
      </button>

      {(creating || editing) && (
        <AccountSheet
          account={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {adjusting && <AdjustSheet account={adjusting} onClose={() => setAdjusting(null)} />}
    </main>
  );
}

function IconAction({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-[0.6875rem] font-medium transition-colors',
        danger ? 'text-ink-faint hover:bg-expense/10 hover:text-expense' : 'text-ink-soft hover:bg-elevated',
      )}
    >
      {children}
      {label}
    </button>
  );
}

function AccountSheet({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const { run } = useData();
  const [name, setName] = useState(account?.name ?? '');
  const [type, setType] = useState(account?.type ?? 'card');
  const [currency, setCurrency] = useState(account?.currency ?? 'UAH');
  const [initialBalance, setInitialBalance] = useState<Minor>(account?.initialBalance ?? 0);
  const [color, setColor] = useState(account?.color ?? COLOR_CHOICES[0]);
  const [icon, setIcon] = useState(account?.icon ?? 'Wallet');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload = { name: name.trim(), type, currency, initialBalance, color, icon };
      await run(() =>
        account ? api.patch(`/api/accounts/${account.id}`, payload) : api.post('/api/accounts', payload),
      );
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не вдалося зберегти');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={account ? 'Редагувати рахунок' : 'Новий рахунок'}
      footer={
        <button type="button" onClick={submit} disabled={busy || !name.trim()} className="btn-primary w-full">
          {busy ? 'Зберігаємо…' : 'Зберегти'}
        </button>
      }
    >
      <div className="space-y-4">
        <Field label="Назва">
          <TextField value={name} onChange={setName} placeholder="Картка Приват" maxLength={60} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Тип">
            <SelectField
              value={type}
              onChange={(v) => setType(v as Account['type'])}
              options={Object.entries(TYPE_LABEL).map(([value, label]) => ({
                value: value as Account['type'],
                label,
              }))}
            />
          </Field>
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
        </div>

        <Field
          label="Початковий баланс"
          hint="Поточний залишок рахується з нього та всіх операцій"
        >
          <AmountInput value={initialBalance} onChange={setInitialBalance} currency={currency} allowNegative />
        </Field>

        <Field label="Колір">
          <div className="flex flex-wrap gap-2">
            {COLOR_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => setColor(choice)}
                aria-label={`Колір ${choice}`}
                className={cn(
                  'h-8 w-8 rounded-xl transition-transform',
                  color === choice && 'scale-110 ring-2 ring-ink ring-offset-2 ring-offset-[rgb(var(--c-surface))]',
                )}
                style={{ background: choice }}
              />
            ))}
          </div>
        </Field>

        <Field label="Іконка">
          <div className="grid max-h-36 grid-cols-7 gap-1 overflow-y-auto rounded-xl border border-line p-2">
            {ICON_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => setIcon(choice)}
                aria-label={choice}
                className={cn(
                  'flex h-9 items-center justify-center rounded-lg transition-colors',
                  icon === choice ? 'bg-accent/15 text-accent' : 'text-ink-soft',
                )}
              >
                <Icon name={choice} size={16} />
              </button>
            ))}
          </div>
        </Field>

        <ErrorNote message={error} />
      </div>
    </Sheet>
  );
}

function AdjustSheet({ account, onClose }: { account: Account; onClose: () => void }) {
  const { run, today } = useData();
  const [target, setTarget] = useState<Minor>(account.balance);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const delta = target - account.balance;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await run(() =>
        api.post(`/api/accounts/${account.id}/adjust`, { targetBalance: target, occurredOn: today }),
      );
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не вдалося зберегти');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Коригування залишку"
      description={account.name}
      footer={
        <button type="button" onClick={submit} disabled={busy || delta === 0} className="btn-primary w-full">
          {busy ? 'Зберігаємо…' : 'Зберегти'}
        </button>
      }
    >
      <div className="space-y-4">
        <p className="rounded-xl bg-elevated px-3 py-2.5 text-xs text-ink-soft">
          Зараз за даними застосунку{' '}
          <span className="tnum font-medium text-ink">
            {formatMoney(account.balance, account.currency)}
          </span>
          . Вкажіть фактичний залишок — різниця запишеться окремою операцією, щоб історія сходилася.
        </p>

        <AmountInput value={target} onChange={setTarget} currency={account.currency} allowNegative autoFocus />

        {delta !== 0 && (
          <p className="text-center text-sm text-ink-soft">
            Коригування:{' '}
            <span className={cn('tnum font-semibold', delta > 0 ? 'text-income' : 'text-expense')}>
              {formatMoney(delta, account.currency, { sign: true })}
            </span>
          </p>
        )}

        <ErrorNote message={error} />
      </div>
    </Sheet>
  );
}
