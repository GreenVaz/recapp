"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, ArchiveRestore, Landmark, Loader2, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { api, del, patch, post } from "@/lib/client";
import { formatMoney, toMajor } from "@/lib/money";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL, CHART_PALETTE, CURRENCIES, type AccountType } from "@/lib/constants";
import { PageHeader } from "@/components/PageHeader";
import { Card, EmptyState } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import type { AccountDTO } from "@/types";

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AccountDTO | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAccounts(await api<AccountDTO[]>("/api/accounts"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleArchive(a: AccountDTO) {
    await patch(`/api/accounts/${a.id}`, { isArchived: !a.isArchived });
    await load();
  }

  async function remove(a: AccountDTO) {
    const count = a._count?.transactions ?? 0;
    const message =
      count > 0
        ? `На рахунку «${a.name}» ${count} операцій. Видалити рахунок разом з історією?`
        : `Видалити рахунок «${a.name}»?`;
    if (!confirm(message)) return;

    try {
      await del(`/api/accounts/${a.id}${count > 0 ? "?force=true" : ""}`);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Не вдалося видалити");
    }
  }

  const activeAccounts = accounts.filter((a) => !a.isArchived);
  const archived = accounts.filter((a) => a.isArchived);

  // Підсумок по валютах — зводити різні валюти в одну суму тут було б брехнею.
  const byCurrency = activeAccounts.reduce<Record<string, number>>((acc, a) => {
    acc[a.currency] = (acc[a.currency] ?? 0) + a.balance;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Рахунки"
        subtitle="Гаманці, картки та банки"
        action={
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="btn-primary"
          >
            <Plus size={16} />
            Новий рахунок
          </button>
        }
      />

      {Object.keys(byCurrency).length > 0 && (
        <div className="mb-6 flex flex-wrap gap-3">
          {Object.entries(byCurrency).map(([currency, sum]) => (
            <div key={currency} className="card px-4 py-3">
              <p className="text-[0.6875rem] text-ink-faint">Разом {currency}</p>
              <p className="tabular text-base font-semibold">{formatMoney(sum, currency)}</p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={20} className="animate-spin text-ink-faint" />
        </div>
      ) : accounts.length === 0 ? (
        <Card>
          <EmptyState text="Ще немає рахунків. Створіть перший." icon={<Wallet size={22} />} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[...activeAccounts, ...archived].map((a) => (
            <div
              key={a.id}
              className={`card group relative p-4 transition-shadow hover:shadow-pop ${
                a.isArchived ? "opacity-55" : ""
              }`}
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-xl"
                    style={{ background: `${a.color}1a`, color: a.color }}
                  >
                    <Wallet size={16} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{a.name}</p>
                    <p className="text-[0.6875rem] text-ink-faint">
                      {ACCOUNT_TYPE_LABEL[a.type as AccountType] ?? a.type} · {a.currency}
                    </p>
                  </div>
                </div>

                <div className="flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    onClick={() => {
                      setEditing(a);
                      setFormOpen(true);
                    }}
                    className="btn-ghost p-1.5"
                    aria-label="Редагувати"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => toggleArchive(a)}
                    className="btn-ghost p-1.5"
                    aria-label={a.isArchived ? "Розархівувати" : "Архівувати"}
                  >
                    {a.isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                  </button>
                  <button
                    onClick={() => remove(a)}
                    className="btn-ghost p-1.5 hover:text-negative"
                    aria-label="Видалити"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              <p className="tabular text-xl font-semibold tracking-tight">
                {formatMoney(a.balance, a.currency)}
              </p>

              <div className="mt-2 flex items-center gap-2 text-[0.6875rem] text-ink-faint">
                <span>{a._count?.transactions ?? 0} операцій</span>
                {a.monoAccountId && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-canvas px-1.5 py-0.5">
                    <Landmark size={10} />
                    Monobank{a.monoMaskedPan ? ` ·${a.monoMaskedPan.slice(-4)}` : ""}
                  </span>
                )}
                {a.isArchived && <span>· в архіві</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <AccountForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSaved={load}
        editing={editing}
      />
    </>
  );
}

function AccountForm({
  open,
  onClose,
  onSaved,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing: AccountDTO | null;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("CARD");
  const [currency, setCurrency] = useState<string>("UAH");
  const [balance, setBalance] = useState("0");
  const [color, setColor] = useState(CHART_PALETTE[0]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setType((editing?.type as AccountType) ?? "CARD");
    setCurrency(editing?.currency ?? "UAH");
    setBalance(editing ? String(toMajor(editing.balance)) : "0");
    setColor(editing?.color ?? CHART_PALETTE[0]);
    setError(null);
  }, [open, editing]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = { name, type, currency, balance, color };
      if (editing) await patch(`/api/accounts/${editing.id}`, payload);
      else await post("/api/accounts", payload);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Редагувати рахунок" : "Новий рахунок"}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="acc-name">
            Назва
          </label>
          <input
            id="acc-name"
            className="field"
            placeholder="Наприклад: Картка Приват"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="acc-type">
              Тип
            </label>
            <select
              id="acc-type"
              className="field"
              value={type}
              onChange={(e) => setType(e.target.value as AccountType)}
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="acc-currency">
              Валюта
            </label>
            <select
              id="acc-currency"
              className="field"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label" htmlFor="acc-balance">
            Поточний баланс
          </label>
          <input
            id="acc-balance"
            className="field tabular"
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
          />
          <p className="mt-1.5 text-[0.6875rem] text-ink-faint">
            Коригується вручну. Для рахунків Monobank баланс перезаписується під час синхронізації.
          </p>
        </div>

        <div>
          <span className="label">Колір</span>
          <div className="flex flex-wrap gap-1.5">
            {CHART_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Колір ${c}`}
                className={`h-7 w-7 rounded-lg transition-transform ${
                  color === c ? "scale-110 ring-2 ring-ink ring-offset-2" : "hover:scale-105"
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>

        {error && <p className="rounded-xl bg-negative/5 px-3 py-2 text-xs text-negative">{error}</p>}

        <div className="flex gap-2 pt-1">
          <button type="submit" className="btn-primary flex-1" disabled={saving}>
            {saving ? "Збереження…" : "Зберегти"}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Скасувати
          </button>
        </div>
      </form>
    </Modal>
  );
}
