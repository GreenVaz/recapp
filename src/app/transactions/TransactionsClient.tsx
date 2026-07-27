"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeftRight,
  ArrowDownLeft,
  ArrowUpRight,
  Pencil,
  Plus,
  Search,
  Trash2,
  Loader2,
} from "lucide-react";
import { api, del } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { SOURCE_LABEL, TX_TYPES, TX_TYPE_LABEL, type TxSource } from "@/lib/constants";
import { PageHeader } from "@/components/PageHeader";
import { Card, EmptyState } from "@/components/ui/Card";
import { CategoryBadge, TransactionForm } from "@/components/TransactionForm";
import type { AccountDTO, CategoryDTO, TransactionDTO } from "@/types";

const PAGE_SIZE = 50;

export function TransactionsClient() {
  const searchParams = useSearchParams();

  const [items, setItems] = useState<TransactionDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [accounts, setAccounts] = useState<AccountDTO[]>([]);
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  const [type, setType] = useState("");
  const [accountId, setAccountId] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TransactionDTO | null>(null);

  // /transactions?new=1 з дашборду одразу відкриває форму.
  useEffect(() => {
    if (searchParams.get("new") === "1") setFormOpen(true);
  }, [searchParams]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE),
    });
    if (type) params.set("type", type);
    if (accountId) params.set("accountId", accountId);
    if (debouncedQuery) params.set("q", debouncedQuery);

    try {
      const data = await api<{ items: TransactionDTO[]; total: number }>(
        `/api/transactions?${params}`,
      );
      setItems(data.items);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [page, type, accountId, debouncedQuery]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void Promise.all([
      api<AccountDTO[]>("/api/accounts").then(setAccounts),
      api<CategoryDTO[]>("/api/categories").then(setCategories),
    ]);
  }, []);

  // Зміна фільтра з ненульової сторінки лишила б порожній список.
  useEffect(() => setPage(0), [type, accountId, debouncedQuery]);

  async function remove(tx: TransactionDTO) {
    if (!confirm(`Видалити операцію на ${formatMoney(tx.amount, tx.currency)}?`)) return;
    await del(`/api/transactions/${tx.id}`);
    await load();
  }

  const grouped = useMemo(() => {
    const map = new Map<string, TransactionDTO[]>();
    for (const tx of items) {
      const key = new Date(tx.date).toISOString().slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), tx]);
    }
    return [...map.entries()];
  }, [items]);

  const pageCount = Math.ceil(total / PAGE_SIZE);

  return (
    <>
      <PageHeader
        title="Транзакції"
        subtitle={`${total} операцій`}
        action={
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="btn-primary"
          >
            <Plus size={16} />
            Додати
          </button>
        }
      />

      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
        <div className="flex items-center gap-1 rounded-xl bg-canvas p-1">
          <button
            onClick={() => setType("")}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
              type === "" ? "bg-surface text-ink shadow-card" : "text-ink-soft hover:text-ink"
            }`}
          >
            Усі
          </button>
          {TX_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                type === t ? "bg-surface text-ink shadow-card" : "text-ink-soft hover:text-ink"
              }`}
            >
              {TX_TYPE_LABEL[t]}
            </button>
          ))}
        </div>

        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="rounded-xl border border-line px-2.5 py-2 text-xs text-ink"
          aria-label="Рахунок"
        >
          <option value="">Усі рахунки</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <div className="relative ml-auto min-w-[12rem] flex-1 sm:max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Пошук за приміткою…"
            className="field py-2 pl-8 text-xs"
          />
        </div>
      </div>

      <Card className="p-0">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 size={20} className="animate-spin text-ink-faint" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            text="Операцій не знайдено. Додайте першу або змініть фільтри."
            icon={<ArrowLeftRight size={22} />}
          />
        ) : (
          <div className="divide-y divide-line">
            {grouped.map(([day, dayItems]) => (
              <div key={day}>
                <div className="flex items-baseline justify-between bg-canvas/60 px-5 py-2">
                  <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-faint">
                    {new Date(day).toLocaleDateString("uk-UA", {
                      day: "numeric",
                      month: "long",
                      weekday: "short",
                    })}
                  </p>
                  <p className="tabular text-[0.6875rem] text-ink-faint">
                    {dayItems.length} оп.
                  </p>
                </div>
                <ul className="divide-y divide-line">
                  {dayItems.map((tx) => (
                    <TransactionRow
                      key={tx.id}
                      tx={tx}
                      onEdit={() => {
                        setEditing(tx);
                        setFormOpen(true);
                      }}
                      onDelete={() => remove(tx)}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      {pageCount > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            className="btn-secondary text-xs"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            Назад
          </button>
          <span className="tabular text-xs text-ink-soft">
            {page + 1} / {pageCount}
          </span>
          <button
            className="btn-secondary text-xs"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            Далі
          </button>
        </div>
      )}

      <TransactionForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSaved={load}
        accounts={accounts}
        categories={categories}
        editing={editing}
      />
    </>
  );
}

function TransactionRow({
  tx,
  onEdit,
  onDelete,
}: {
  tx: TransactionDTO;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isIncome = tx.type === "INCOME";
  const isTransfer = tx.type === "TRANSFER";
  const IconCmp = isTransfer ? ArrowLeftRight : isIncome ? ArrowDownLeft : ArrowUpRight;
  const tone = isTransfer ? "text-ink-soft" : isIncome ? "text-positive" : "text-negative";

  return (
    <li className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-canvas/50">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
          isTransfer ? "bg-canvas" : isIncome ? "bg-positive/10" : "bg-negative/10"
        } ${tone}`}
      >
        <IconCmp size={15} strokeWidth={2} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-ink">
          {tx.note || (isTransfer ? `${tx.account.name} → ${tx.toAccount?.name ?? "?"}` : "Без опису")}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
          {!isTransfer && <CategoryBadge category={tx.category} />}
          <span className="text-[0.6875rem] text-ink-faint">{tx.account.name}</span>
          {tx.source !== "MANUAL" && (
            <span className="rounded-md bg-canvas px-1.5 py-0.5 text-[0.625rem] text-ink-faint">
              {SOURCE_LABEL[tx.source as TxSource] ?? tx.source}
            </span>
          )}
          {tx.tags &&
            tx.tags
              .split(",")
              .filter(Boolean)
              .map((t) => (
                <span key={t} className="text-[0.625rem] text-accent">
                  #{t.trim()}
                </span>
              ))}
        </div>
      </div>

      <p className={`tabular shrink-0 text-sm font-medium ${tone}`}>
        {isTransfer ? "" : isIncome ? "+" : "−"}
        {formatMoney(tx.amount, tx.currency)}
      </p>

      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <button onClick={onEdit} className="btn-ghost p-1.5" aria-label="Редагувати">
          <Pencil size={14} />
        </button>
        <button
          onClick={onDelete}
          className="btn-ghost p-1.5 hover:text-negative"
          aria-label="Видалити"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  );
}
