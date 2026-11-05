import { useState } from 'react';
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api.js';
import { useData } from '@/lib/store.js';
import { cn } from '@/lib/format.js';
import { BackHeader } from '@/components/AppHeader.js';
import { Card, EmptyState, ErrorNote, FullScreenLoader, Segmented } from '@/components/ui.js';
import { Sheet } from '@/components/Sheet.js';
import { Field, SelectField, TextField } from '@/components/fields.js';
import { COLOR_CHOICES, Icon, ICON_CHOICES } from '@/components/Icon.js';
import type { Category } from '@core/types.js';

export function CategoriesScreen() {
  const { data, run } = useData();
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState<{ parentId: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!data) return <FullScreenLoader />;

  const visible = data.categories.filter((c) => c.kind === kind);
  const parents = visible.filter((c) => !c.parentId);

  async function remove(category: Category) {
    const children = data!.categories.filter((c) => c.parentId === category.id).length;
    const warning = children > 0 ? `\n\nРазом із нею зникнуть ${children} підкатегорій.` : '';
    if (!confirm(`Видалити «${category.name}»?${warning}\n\nОперації залишаться без категорії.`)) return;

    try {
      await run(() => api.del(`/api/categories/${category.id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не вдалося видалити');
    }
  }

  return (
    <main className="page">
      <BackHeader title="Категорії" />

      <Segmented
        value={kind}
        onChange={setKind}
        className="mb-3 w-full"
        options={[
          { value: 'expense', label: 'Витрати' },
          { value: 'income', label: 'Доходи' },
        ]}
      />

      <ErrorNote message={error} />

      {parents.length === 0 ? (
        <Card>
          <EmptyState icon={<Tags size={22} />} title="Категорій цього типу немає" />
        </Card>
      ) : (
        <ul className="space-y-2">
          {parents.map((parent) => {
            const children = visible.filter((c) => c.parentId === parent.id);
            return (
              <li key={parent.id}>
                <Card className="p-3.5">
                  <div className="flex items-center gap-3">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                      style={{ background: `${parent.color}22`, color: parent.color }}
                    >
                      <Icon name={parent.icon} size={17} />
                    </span>
                    <p className="min-w-0 flex-1 truncate text-[0.9375rem] font-medium">{parent.name}</p>
                    <button
                      type="button"
                      onClick={() => setEditing(parent)}
                      aria-label="Редагувати"
                      className="rounded-lg p-1.5 text-ink-faint hover:text-ink"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(parent)}
                      aria-label="Видалити"
                      className="rounded-lg p-1.5 text-ink-faint hover:text-expense"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  {children.length > 0 && (
                    <ul className="mt-2 space-y-0.5 border-t border-line pt-2">
                      {children.map((child) => (
                        <li key={child.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5">
                          <span
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                            style={{ background: `${child.color}22`, color: child.color }}
                          >
                            <Icon name={child.icon} size={12} />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">{child.name}</span>
                          <button
                            type="button"
                            onClick={() => setEditing(child)}
                            aria-label="Редагувати"
                            className="rounded-md p-1 text-ink-faint hover:text-ink"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => void remove(child)}
                            aria-label="Видалити"
                            className="rounded-md p-1 text-ink-faint hover:text-expense"
                          >
                            <Trash2 size={13} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <button
                    type="button"
                    onClick={() => setCreating({ parentId: parent.id })}
                    className="mt-1.5 flex w-full items-center gap-1.5 rounded-lg px-1 py-1.5 text-xs text-accent"
                  >
                    <Plus size={13} />
                    Підкатегорія
                  </button>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setCreating({ parentId: null })}
        className="btn-primary mt-4 w-full"
      >
        <Plus size={17} />
        Нова категорія
      </button>

      {(creating || editing) && (
        <CategorySheet
          category={editing}
          parentId={creating?.parentId ?? null}
          kind={kind}
          categories={data.categories}
          onClose={() => {
            setCreating(null);
            setEditing(null);
          }}
        />
      )}
    </main>
  );
}

function CategorySheet({
  category,
  parentId,
  kind,
  categories,
  onClose,
}: {
  category: Category | null;
  parentId: string | null;
  kind: 'expense' | 'income';
  categories: Category[];
  onClose: () => void;
}) {
  const { run } = useData();
  const [name, setName] = useState(category?.name ?? '');
  const [parent, setParent] = useState(category?.parentId ?? parentId ?? '');
  const [icon, setIcon] = useState(category?.icon ?? 'Circle');
  const [color, setColor] = useState(category?.color ?? COLOR_CHOICES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasChildren = categories.some((c) => c.parentId === category?.id);
  const parentOptions = categories.filter(
    (c) => c.kind === kind && !c.parentId && c.id !== category?.id,
  );

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload = { name: name.trim(), kind, parentId: parent || null, icon, color };
      await run(() =>
        category ? api.patch(`/api/categories/${category.id}`, payload) : api.post('/api/categories', payload),
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
      title={category ? 'Редагувати категорію' : 'Нова категорія'}
      footer={
        <button type="button" onClick={submit} disabled={busy || !name.trim()} className="btn-primary w-full">
          {busy ? 'Зберігаємо…' : 'Зберегти'}
        </button>
      }
    >
      <div className="space-y-4">
        <Field label="Назва">
          <TextField value={name} onChange={setName} maxLength={60} placeholder="Наприклад: Продукти" />
        </Field>

        <Field
          label="Батьківська категорія"
          hint={hasChildren ? 'Має підкатегорії — рівень змінити не можна' : 'Підтримується два рівні'}
        >
          <SelectField
            value={hasChildren ? '' : parent}
            onChange={setParent}
            placeholder="— верхній рівень —"
            options={
              hasChildren ? [] : parentOptions.map((p) => ({ value: p.id, label: p.name }))
            }
          />
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

        <div className="flex items-center gap-2.5 rounded-xl bg-elevated p-3">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: `${color}22`, color }}
          >
            <Icon name={icon} size={17} />
          </span>
          <span className="text-sm">{name || 'Попередній перегляд'}</span>
        </div>

        <ErrorNote message={error} />
      </div>
    </Sheet>
  );
}
