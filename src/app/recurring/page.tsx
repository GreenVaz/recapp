"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Check, Loader2, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { api, del, patch, post } from "@/lib/client";
import { formatMoney, toMajor } from "@/lib/money";
import { CURRENCIES, FREQUENCIES, FREQUENCY_LABEL, type Frequency } from "@/lib/constants";
import { PageHeader } from "@/components/PageHeader";
import { Card, EmptyState } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "@/components/ui/Icon";
import type { AccountDTO, CategoryDTO, RecurringDTO } from "@/types";

function daysUntil(iso: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(iso);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function dueLabel(days: number) {
  if (days < 0) return { text: `прострочено на ${-days} дн.`, tone: "text-negative" };
  if (days === 0) return { text: "сьогодні", tone: "text-negative" };
  if (days === 1) return { text: "завтра", tone: "text-warning" };
  if (days <= 7) return { text: `через ${days} дн.`, tone: "text-warning" };
  return { text: `через ${days} дн.`, tone: "text-ink-faint" };
}

export default function RecurringPage() {
  const [items, setItems] = useState<RecurringDTO[]>([]);
  const [accounts, setAccounts] = useState<AccountDTO[]>([]);
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringDTO | null>(null);
  const [postingId, setPostingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, a, c] = await Promise.all([
        api<RecurringDTO[]>("/api/recurring"),
        api<AccountDTO[]>("/api/accounts"),
        api<CategoryDTO[]>("/api/categories"),
      ]);
      setItems(r);
      setAccounts(a);
      setCategories(c);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function postNow(r: RecurringDTO) {
    if (!confirm(`Провести «${r.name}» на ${formatMoney(r.amount, r.currency)}?`)) return;
    setPostingId(r.id);
    try {
      await post(`/api/recurring/${r.id}/post`, {});
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Не вдалося провести платіж");
    } finally {
      setPostingId(null);
    }
  }

  async function toggleActive(r: RecurringDTO) {
    await patch(`/api/recurring/${r.id}`, { isActive: !r.isActive });
    await load();
  }

  async function remove(r: RecurringDTO) {
    if (!confirm(`Видалити регулярний платіж «${r.name}»?`)) return;
    await del(`/api/recurring/${r.id}`);
    await load();
  }

  const monthlyTotal = items
    .filter((r) => r.isActive && r.type === "EXPENSE" && r.frequency === "MONTHLY")
    .reduce<Record<string, number>>((acc, r) => {
      acc[r.currency] = (acc[r.currency] ?? 0) + r.amount;
      return acc;
    }, {});

  return (
    <>
      <PageHeader
        title="Регулярні платежі"
        subtitle="Підписки, оренда, комуналка"
        action={
          <button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            className="btn-primary"
          >
            <Plus size={16} />
            Новий платіж
          </button>
        }
      />

      {Object.keys(monthlyTotal).length > 0 && (
        <div className="mb-6 flex flex-wrap gap-3">
          {Object.entries(monthlyTotal).map(([currency, sum]) => (
            <div key={currency} className="card px-4 py-3">
              <p className="text-[0.6875rem] text-ink-faint">Щомісячні витрати</p>
              <p className="tabular text-base font-semibold">{formatMoney(sum, currency)}</p>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={20} className="animate-spin text-ink-faint" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            text="Регулярних платежів немає. Додайте підписки чи оренду — застосунок нагадає заздалегідь."
            icon={<CalendarClock size={22} />}
          />
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line">
            {items.map((r) => {
              const days = daysUntil(r.nextDueDate);
              const label = dueLabel(days);
              return (
                <li
                  key={r.id}
                  className={`group flex flex-wrap items-center gap-3 px-5 py-3.5 transition-colors hover:bg-canvas/50 ${
                    r.isActive ? "" : "opacity-55"
                  }`}
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                    style={{
                      background: `${r.category?.color ?? "#8a8a84"}1a`,
                      color: r.category?.color ?? "#8a8a84",
                    }}
                  >
                    <Icon name={r.category?.icon ?? "Repeat"} size={16} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{r.name}</p>
                    <p className="mt-0.5 truncate text-[0.6875rem] text-ink-faint">
                      {FREQUENCY_LABEL[r.frequency as Frequency]} · {r.account.name}
                      {r.category ? ` · ${r.category.name}` : ""}
                      {r.lastPostedAt
                        ? ` · востаннє ${new Date(r.lastPostedAt).toLocaleDateString("uk-UA")}`
                        : ""}
                    </p>
                  </div>

                  <div className="text-right">
                    <p
                      className={`tabular text-sm font-medium ${
                        r.type === "INCOME" ? "text-positive" : "text-ink"
                      }`}
                    >
                      {r.type === "INCOME" ? "+" : ""}
                      {formatMoney(r.amount, r.currency)}
                    </p>
                    <p className={`text-[0.6875rem] ${r.isActive ? label.tone : "text-ink-faint"}`}>
                      {r.isActive
                        ? `${new Date(r.nextDueDate).toLocaleDateString("uk-UA", {
                            day: "numeric",
                            month: "short",
                          })} — ${label.text}`
                        : "призупинено"}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      onClick={() => postNow(r)}
                      className="btn-ghost p-1.5 hover:text-positive"
                      aria-label="Провести зараз"
                      disabled={postingId === r.id}
                    >
                      {postingId === r.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Check size={14} />
                      )}
                    </button>
                    <button
                      onClick={() => toggleActive(r)}
                      className="btn-ghost p-1.5"
                      aria-label={r.isActive ? "Призупинити" : "Відновити"}
                    >
                      {r.isActive ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                    <button
                      onClick={() => {
                        setEditing(r);
                        setFormOpen(true);
                      }}
                      className="btn-ghost p-1.5"
                      aria-label="Редагувати"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => remove(r)}
                      className="btn-ghost p-1.5 hover:text-negative"
                      aria-label="Видалити"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <RecurringForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSaved={load}
        editing={editing}
        accounts={accounts}
        categories={categories}
      />
    </>
  );
}

function RecurringForm({
  open,
  onClose,
  onSaved,
  editing,
  accounts,
  categories,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing: RecurringDTO | null;
  accounts: AccountDTO[];
  categories: CategoryDTO[];
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("UAH");
  const [frequency, setFrequency] = useState<Frequency>("MONTHLY");
  const [anchorDate, setAnchorDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reminderDays, setReminderDays] = useState(3);
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const active = accounts.filter((a) => !a.isArchived);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setType(editing.type as "EXPENSE" | "INCOME");
      setAmount(String(toMajor(editing.amount)));
      setCurrency(editing.currency);
      setFrequency(editing.frequency as Frequency);
      setAnchorDate(new Date(editing.anchorDate).toISOString().slice(0, 10));
      setReminderDays(editing.reminderDays);
      setAccountId(editing.accountId);
      setCategoryId(editing.categoryId ?? "");
      setNote(editing.note ?? "");
    } else {
      setName("");
      setType("EXPENSE");
      setAmount("");
      setCurrency(active[0]?.currency ?? "UAH");
      setFrequency("MONTHLY");
      setAnchorDate(new Date().toISOString().slice(0, 10));
      setReminderDays(3);
      setAccountId(active[0]?.id ?? "");
      setCategoryId("");
      setNote("");
    }
    setError(null);
  }, [open, editing, active]);

  const parents = categories.filter((c) => c.kind === type && !c.parentId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name,
        type,
        amount,
        currency,
        frequency,
        anchorDate,
        reminderDays,
        accountId,
        categoryId: categoryId || null,
        note: note || null,
      };
      if (editing) await patch(`/api/recurring/${editing.id}`, payload);
      else await post("/api/recurring", payload);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Редагувати платіж" : "Новий регулярний платіж"}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="rec-name">
            Назва
          </label>
          <input
            id="rec-name"
            className="field"
            placeholder="Наприклад: Netflix"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl bg-canvas p-1">
          {(["EXPENSE", "INCOME"] as const).map((t) => (
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
              {t === "EXPENSE" ? "Витрата" : "Дохід"}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="rec-amount">
              Сума
            </label>
            <input
              id="rec-amount"
              className="field tabular"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="rec-currency">
              Валюта
            </label>
            <select
              id="rec-currency"
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

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="rec-frequency">
              Періодичність
            </label>
            <select
              id="rec-frequency"
              className="field"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Frequency)}
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABEL[f]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="rec-anchor">
              Дата першого платежу
            </label>
            <input
              id="rec-anchor"
              type="date"
              className="field"
              value={anchorDate}
              onChange={(e) => setAnchorDate(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="rec-account">
              Рахунок
            </label>
            <select
              id="rec-account"
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
          <div>
            <label className="label" htmlFor="rec-category">
              Категорія
            </label>
            <select
              id="rec-category"
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
        </div>

        <div>
          <label className="label" htmlFor="rec-reminder">
            Нагадати за (днів)
          </label>
          <input
            id="rec-reminder"
            type="number"
            min={0}
            max={30}
            className="field tabular"
            value={reminderDays}
            onChange={(e) => setReminderDays(Number(e.target.value))}
          />
          <p className="mt-1.5 text-[0.6875rem] text-ink-faint">
            Нагадування з’являється на дашборді. Платіж проводиться кнопкою «✓».
          </p>
        </div>

        <div>
          <label className="label" htmlFor="rec-note">
            Примітка
          </label>
          <input
            id="rec-note"
            className="field"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
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
