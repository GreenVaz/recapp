"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { api, del, patch, post } from "@/lib/client";
import { CHART_PALETTE, CATEGORY_KINDS, type CategoryKind } from "@/lib/constants";
import { PageHeader } from "@/components/PageHeader";
import { Card, EmptyState } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Icon, ICON_CHOICES } from "@/components/ui/Icon";
import type { CategoryDTO } from "@/types";

const KIND_LABEL: Record<CategoryKind, string> = { EXPENSE: "Витрати", INCOME: "Доходи" };

export default function CategoriesPage() {
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [kind, setKind] = useState<CategoryKind>("EXPENSE");
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryDTO | null>(null);
  const [presetParent, setPresetParent] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCategories(await api<CategoryDTO[]>("/api/categories"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(c: CategoryDTO) {
    const children = c._count?.children ?? 0;
    const txCount = c._count?.transactions ?? 0;
    const warning = [
      children > 0 ? `${children} підкатегорій буде видалено разом із нею` : null,
      txCount > 0 ? `${txCount} операцій залишаться без категорії` : null,
    ].filter(Boolean);

    if (!confirm(`Видалити «${c.name}»?${warning.length ? `\n\n${warning.join(".\n")}.` : ""}`)) return;
    await del(`/api/categories/${c.id}`);
    await load();
  }

  const visible = categories.filter((c) => c.kind === kind);
  const parents = visible.filter((c) => !c.parentId);

  return (
    <>
      <PageHeader
        title="Категорії"
        subtitle="Дворівнева структура: категорія → підкатегорія"
        action={
          <button
            onClick={() => {
              setEditing(null);
              setPresetParent(null);
              setFormOpen(true);
            }}
            className="btn-primary"
          >
            <Plus size={16} />
            Нова категорія
          </button>
        }
      />

      <div className="mb-4 inline-flex gap-1 rounded-xl bg-canvas p-1">
        {CATEGORY_KINDS.map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              kind === k ? "bg-surface text-ink shadow-card" : "text-ink-soft hover:text-ink"
            }`}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={20} className="animate-spin text-ink-faint" />
        </div>
      ) : parents.length === 0 ? (
        <Card>
          <EmptyState text="Категорій цього типу ще немає." icon={<Tags size={22} />} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {parents.map((parent) => {
            const children = visible.filter((c) => c.parentId === parent.id);
            return (
              <Card key={parent.id} className="p-4">
                <div className="group mb-3 flex items-center gap-2.5">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: `${parent.color}1a`, color: parent.color }}
                  >
                    <Icon name={parent.icon} size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{parent.name}</p>
                    <p className="text-[0.6875rem] text-ink-faint">
                      {children.length} підкатегорій · {parent._count?.transactions ?? 0} операцій
                    </p>
                  </div>
                  <div className="flex gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <button
                      onClick={() => {
                        setEditing(parent);
                        setFormOpen(true);
                      }}
                      className="btn-ghost p-1.5"
                      aria-label="Редагувати"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => remove(parent)}
                      className="btn-ghost p-1.5 hover:text-negative"
                      aria-label="Видалити"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <ul className="space-y-0.5">
                  {children.map((c) => (
                    <li
                      key={c.id}
                      className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-canvas"
                    >
                      <span
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
                        style={{ background: `${c.color}1a`, color: c.color }}
                      >
                        <Icon name={c.icon} size={11} />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">{c.name}</span>
                      <span className="tabular shrink-0 text-[0.625rem] text-ink-faint">
                        {c._count?.transactions ?? 0}
                      </span>
                      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                        <button
                          onClick={() => {
                            setEditing(c);
                            setFormOpen(true);
                          }}
                          className="btn-ghost p-1"
                          aria-label="Редагувати"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => remove(c)}
                          className="btn-ghost p-1 hover:text-negative"
                          aria-label="Видалити"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => {
                    setEditing(null);
                    setPresetParent(parent.id);
                    setFormOpen(true);
                  }}
                  className="btn-ghost mt-1.5 w-full justify-start px-2 py-1.5 text-xs"
                >
                  <Plus size={13} />
                  Підкатегорія
                </button>
              </Card>
            );
          })}
        </div>
      )}

      <CategoryForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
          setPresetParent(null);
        }}
        onSaved={load}
        editing={editing}
        presetParent={presetParent}
        presetKind={kind}
        categories={categories}
      />
    </>
  );
}

function CategoryForm({
  open,
  onClose,
  onSaved,
  editing,
  presetParent,
  presetKind,
  categories,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editing: CategoryDTO | null;
  presetParent: string | null;
  presetKind: CategoryKind;
  categories: CategoryDTO[];
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CategoryKind>(presetKind);
  const [parentId, setParentId] = useState("");
  const [icon, setIcon] = useState("Circle");
  const [color, setColor] = useState(CHART_PALETTE[0]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setKind((editing?.kind as CategoryKind) ?? presetKind);
    setParentId(editing?.parentId ?? presetParent ?? "");
    setIcon(editing?.icon ?? "Circle");
    setColor(editing?.color ?? CHART_PALETTE[0]);
    setError(null);
  }, [open, editing, presetParent, presetKind]);

  // Підкатегорія не може стати батьком — показуємо лише кореневі категорії.
  const parentOptions = categories.filter(
    (c) => c.kind === kind && !c.parentId && c.id !== editing?.id,
  );
  const hasChildren = (editing?._count?.children ?? 0) > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = { name, kind, parentId: parentId || null, icon, color };
      if (editing) await patch(`/api/categories/${editing.id}`, payload);
      else await post("/api/categories", payload);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Редагувати категорію" : "Нова категорія"}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="cat-name">
            Назва
          </label>
          <input
            id="cat-name"
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="cat-kind">
              Тип
            </label>
            <select
              id="cat-kind"
              className="field"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as CategoryKind);
                setParentId("");
              }}
            >
              {CATEGORY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="cat-parent">
              Батьківська категорія
            </label>
            <select
              id="cat-parent"
              className="field"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              disabled={hasChildren}
            >
              <option value="">— верхній рівень —</option>
              {parentOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {hasChildren && (
              <p className="mt-1 text-[0.6875rem] text-ink-faint">
                Має підкатегорії — рівень змінити не можна.
              </p>
            )}
          </div>
        </div>

        <div>
          <span className="label">Іконка</span>
          <div className="grid max-h-40 grid-cols-8 gap-1 overflow-y-auto rounded-xl border border-line p-2">
            {ICON_CHOICES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setIcon(n)}
                aria-label={n}
                className={`flex h-8 items-center justify-center rounded-lg transition-colors ${
                  icon === n ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-canvas"
                }`}
              >
                <Icon name={n} size={15} />
              </button>
            ))}
          </div>
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

        <div className="flex items-center gap-2.5 rounded-xl bg-canvas p-3">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-xl"
            style={{ background: `${color}1a`, color }}
          >
            <Icon name={icon} size={15} />
          </span>
          <span className="text-sm text-ink">{name || "Попередній перегляд"}</span>
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
