import { useMemo, useState } from 'react';
import { ArrowLeftRight, Check, Search, Trash2 } from 'lucide-react';
import { formatMoney } from '@core/money.js';
import { api, ApiError } from '@/lib/api.js';
import { useData } from '@/lib/store.js';
import { cn, formatDate } from '@/lib/format.js';
import { BackHeader } from '@/components/AppHeader.js';
import { Card, EmptyState, ErrorNote, FullScreenLoader, Segmented } from '@/components/ui.js';
import { Icon } from '@/components/Icon.js';
import type { Transaction } from '@core/types.js';

type Filter = 'all' | 'expense' | 'income' | 'transfer';

export function TransactionsScreen() {
  const { data, ledger, run, today } = useData();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const accounts = useMemo(
    () => new Map((data?.accounts ?? []).map((a) => [a.id, a])),
    [data],
  );
  const categories = useMemo(
    () => new Map((data?.categories ?? []).map((c) => [c.id, c])),
    [data],
  );

  const items = useMemo(() => {
    const all = ledger?.transactions ?? [];
    const needle = query.trim().toLowerCase();

    return all
      .filter((tx) => (filter === 'all' ? true : tx.kind === filter))
      .filter((tx) => (needle ? (tx.note ?? '').toLowerCase().includes(needle) : true))
      .sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : a.occurredOn > b.occurredOn ? -1 : 0));
  }, [ledger, filter, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const tx of items) map.set(tx.occurredOn, [...(map.get(tx.occurredOn) ?? []), tx]);
    return [...map.entries()];
  }, [items]);

  if (!data) return <FullScreenLoader />;

  async function remove(tx: Transaction) {
    if (!confirm('Видалити операцію? Баланс рахунку перерахується.')) return;
    try {
      await run(() => api.del(`/api/transactions/${tx.id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не вдалося видалити');
    }
  }

  async function markPosted(tx: Transaction) {
    try {
      await run(() => api.post(`/api/transactions/${tx.id}/post`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не вдалося провести');
    }
  }

  return (
    <main className="page">
      <BackHeader title="Операції" to="/" />

      <div className="mb-3 space-y-2">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Пошук за коментарем"
            className="field py-2.5 pl-9 text-sm"
          />
        </div>

        <Segmented
          size="sm"
          value={filter}
          onChange={setFilter}
          className="w-full"
          options={[
            { value: 'all', label: 'Усі' },
            { value: 'expense', label: 'Витрати' },
            { value: 'income', label: 'Доходи' },
            { value: 'transfer', label: 'Перекази' },
          ]}
        />
      </div>

      <ErrorNote message={error} />

      {grouped.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ArrowLeftRight size={22} />}
            title="Операцій не знайдено"
            description="Змініть фільтри або додайте першу операцію кнопкою «+»."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {grouped.map(([date, dayItems]) => (
            <Card key={date} className="p-0">
              <p className="border-b border-line px-4 py-2 text-xs font-medium text-ink-soft">
                {formatDate(date, today)}
              </p>
              <ul className="divide-y divide-line">
                {dayItems.map((tx) => {
                  const account = accounts.get(tx.accountId);
                  const category = tx.categoryId ? categories.get(tx.categoryId) : null;
                  const isIncome = tx.kind === 'income' || (tx.kind === 'adjustment' && tx.amount > 0);
                  const isTransfer = tx.kind === 'transfer';

                  return (
                    <li key={tx.id} className="flex items-center gap-3 px-4 py-2.5">
                      <span
                        className={cn(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                          isTransfer
                            ? 'bg-elevated text-ink-soft'
                            : isIncome
                              ? 'bg-income/12 text-income'
                              : 'bg-expense/12 text-expense',
                        )}
                        style={
                          category
                            ? { background: `${category.color}22`, color: category.color }
                            : undefined
                        }
                      >
                        <Icon
                          name={
                            category?.icon ??
                            (isTransfer ? 'ArrowLeftRight' : isIncome ? 'ArrowDownLeft' : 'ArrowUpRight')
                          }
                          size={16}
                        />
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink">
                          {tx.note ||
                            (isTransfer
                              ? `${account?.name ?? '?'} → ${accounts.get(tx.counterAccountId ?? '')?.name ?? '?'}`
                              : (category?.name ?? 'Без категорії'))}
                        </p>
                        <p className="truncate text-[0.6875rem] text-ink-faint">
                          {account?.name}
                          {tx.status === 'planned' && ' · заплановано'}
                          {tx.kind === 'adjustment' && ' · коригування'}
                        </p>
                      </div>

                      <p
                        className={cn(
                          'tnum shrink-0 text-sm font-medium',
                          isTransfer ? 'text-ink-soft' : isIncome ? 'text-income' : 'text-ink',
                        )}
                      >
                        {isTransfer ? '' : isIncome ? '+' : '−'}
                        {formatMoney(Math.abs(tx.amount), tx.currency, { trimCents: true })}
                      </p>

                      <div className="flex shrink-0 gap-0.5">
                        {tx.status === 'planned' && (
                          <button
                            type="button"
                            onClick={() => void markPosted(tx)}
                            aria-label="Позначити виконаною"
                            className="rounded-lg p-1.5 text-ink-faint transition-colors hover:text-income"
                          >
                            <Check size={15} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void remove(tx)}
                          aria-label="Видалити"
                          className="rounded-lg p-1.5 text-ink-faint transition-colors hover:text-expense"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
