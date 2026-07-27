"use client";

import { useEffect, useMemo, useState } from "react";
import { post, patch } from "@/lib/client";
import { toMajor } from "@/lib/money";
import { TX_TYPES, TX_TYPE_LABEL, type TxType } from "@/lib/constants";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "@/components/ui/Icon";
import type { AccountDTO, CategoryDTO, TransactionDTO } from "@/types";

const today = () => new Date().toISOString().slice(0, 10);

export function TransactionForm({
  open,
  onClose,
  onSaved,
  accounts,
  categories,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  accounts: AccountDTO[];
  categories: CategoryDTO[];
  editing?: TransactionDTO | null;
}) {
  const [type, setType] = useState<TxType>("EXPENSE");
  const [amount, setAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const active = useMemo(() => accounts.filter((a) => !a.isArchived), [accounts]);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setType(editing.type as TxType);
      setAmount(String(toMajor(editing.amount)));
      setToAmount(editing.toAmount ? String(toMajor(editing.toAmount)) : "");
      setAccountId(editing.accountId);
      setToAccountId(editing.toAccountId ?? "");
      setCategoryId(editing.categoryId ?? "");
      setDate(new Date(editing.date).toISOString().slice(0, 10));
      setNote(editing.note ?? "");
      setTags(editing.tags ?? "");
    } else {
      setType("EXPENSE");
      setAmount("");
      setToAmount("");
      setAccountId(active[0]?.id ?? "");
      setToAccountId("");
      setCategoryId("");
      setDate(today());
      setNote("");
      setTags("");
    }
    setError(null);
  }, [open, editing, active]);

  const sourceAccount = active.find((a) => a.id === accountId);
  const targetAccount = active.find((a) => a.id === toAccountId);
  const crossCurrency =
    type === "TRANSFER" && sourceAccount && targetAccount && sourceAccount.currency !== targetAccount.currency;

  const kind = type === "INCOME" ? "INCOME" : "EXPENSE";
  const parents = categories.filter((c) => c.kind === kind && !c.parentId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        type,
        amount,
        toAmount: crossCurrency ? toAmount : null,
        accountId,
        toAccountId: type === "TRANSFER" ? toAccountId : null,
        categoryId: type === "TRANSFER" ? null : categoryId || null,
        date,
        note: note || null,
        tags,
      };
      if (editing) await patch(`/api/transactions/${editing.id}`, payload);
      else await post("/api/transactions", payload);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Редагувати операцію" : "Нова операція"}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-canvas p-1">
          {TX_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setType(t);
                setCategoryId("");
              }}
              className={`rounded-lg py-2 text-xs font-medium transition-colors ${
                type === t ? "bg-surface text-ink shadow-card" : "text-ink-soft hover:text-ink"
              }`}
            >
              {TX_TYPE_LABEL[t]}
            </button>
          ))}
        </div>

        <div>
          <label className="label" htmlFor="tx-amount">
            Сума {sourceAccount ? `(${sourceAccount.currency})` : ""}
          </label>
          <input
            id="tx-amount"
            className="field tabular text-lg font-medium"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="tx-account">
              {type === "TRANSFER" ? "З рахунку" : "Рахунок"}
            </label>
            <select
              id="tx-account"
              className="field"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
            >
              {active.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </select>
          </div>

          {type === "TRANSFER" ? (
            <div>
              <label className="label" htmlFor="tx-to-account">
                На рахунок
              </label>
              <select
                id="tx-to-account"
                className="field"
                value={toAccountId}
                onChange={(e) => setToAccountId(e.target.value)}
                required
              >
                <option value="">Оберіть…</option>
                {active
                  .filter((a) => a.id !== accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="label" htmlFor="tx-category">
                Категорія
              </label>
              <select
                id="tx-category"
                className="field"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">Без категорії</option>
                {parents.map((parent) => {
                  const children = categories.filter((c) => c.parentId === parent.id);
                  return (
                    <optgroup key={parent.id} label={parent.name}>
                      {children.length === 0 ? (
                        <option value={parent.id}>{parent.name}</option>
                      ) : (
                        children.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))
                      )}
                    </optgroup>
                  );
                })}
              </select>
            </div>
          )}
        </div>

        {crossCurrency && (
          <div className="rounded-xl bg-accent-soft p-3">
            <label className="label" htmlFor="tx-to-amount">
              Сума зарахування ({targetAccount!.currency})
            </label>
            <input
              id="tx-to-amount"
              className="field tabular"
              inputMode="decimal"
              placeholder="0.00"
              value={toAmount}
              onChange={(e) => setToAmount(e.target.value)}
              required
            />
            <p className="mt-1.5 text-[0.6875rem] text-ink-soft">
              Валюти рахунків різні — вкажіть, скільки фактично зарахувалося.
            </p>
          </div>
        )}

        <div>
          <label className="label" htmlFor="tx-date">
            Дата
          </label>
          <input
            id="tx-date"
            type="date"
            className="field"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="label" htmlFor="tx-note">
            Примітка
          </label>
          <input
            id="tx-note"
            className="field"
            placeholder="Наприклад: обід із командою"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="tx-tags">
            Теги (через кому)
          </label>
          <input
            id="tx-tags"
            className="field"
            placeholder="робота, відрядження"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </div>

        {error && (
          <p className="rounded-xl bg-negative/5 px-3 py-2 text-xs text-negative">{error}</p>
        )}

        <div className="flex gap-2 pt-1">
          <button type="submit" className="btn-primary flex-1" disabled={saving}>
            {saving ? "Збереження…" : editing ? "Зберегти" : "Додати"}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Скасувати
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function CategoryBadge({
  category,
}: {
  category: { name: string; icon: string; color: string } | null;
}) {
  if (!category) return <span className="text-xs text-ink-faint">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
      <span
        className="flex h-5 w-5 items-center justify-center rounded-md"
        style={{ background: `${category.color}1a`, color: category.color }}
      >
        <Icon name={category.icon} size={11} />
      </span>
      {category.name}
    </span>
  );
}
