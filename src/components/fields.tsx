import { useId, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { fromMajor, toMajor, type Minor } from '@core/money.js';
import type { Account, Category } from '@/lib/types.js';
import { cn } from '@/lib/format.js';
import { Icon } from './Icon.js';

/** Поля форм. Усі оптимізовані під введення однією рукою на телефоні. */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="block">
      {label && <span className="label">{label}</span>}
      {children}
      {error ? (
        <span className="mt-1.5 block text-xs text-expense">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-ink-faint">{hint}</span>
      ) : null}
    </label>
  );
}

/**
 * Введення суми.
 *
 * inputMode="decimal" викликає цифрову клавіатуру на iOS — звичайний
 * text дав би повну розкладку, і вводити суму довелося б удвічі довше.
 * Назовні значення завжди в мінорних одиницях, тож дробів у стані форми
 * не існує.
 */
export function AmountInput({
  value,
  onChange,
  currency,
  autoFocus,
  allowNegative = false,
  placeholder = '0',
}: {
  value: Minor;
  onChange: (value: Minor) => void;
  currency: string;
  autoFocus?: boolean;
  allowNegative?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === 0 ? '' : String(toMajor(value)));

  return (
    <div className="flex items-baseline gap-2 rounded-2xl border border-line bg-elevated px-4 py-3.5 focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15">
      <input
        inputMode="decimal"
        autoFocus={autoFocus}
        value={shown}
        placeholder={placeholder}
        onChange={(e) => {
          const next = e.target.value.replace(/[^\d.,-]/g, '');
          setDraft(next);
          onChange(fromMajor(allowNegative ? next : next.replace('-', '')));
        }}
        onBlur={() => setDraft(null)}
        className="tnum min-w-0 flex-1 bg-transparent text-3xl font-semibold tracking-tight text-ink placeholder:text-ink-faint"
        aria-label="Сума"
      />
      <span className="shrink-0 text-lg font-medium text-ink-soft">{currency}</span>
    </div>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
  maxLength = 300,
  type = 'text',
  autoComplete,
  inputMode,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  type?: 'text' | 'email' | 'password';
  autoComplete?: string;
  inputMode?: 'text' | 'email' | 'numeric';
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      autoComplete={autoComplete}
      inputMode={inputMode}
      onChange={(e) => onChange(e.target.value)}
      className="field"
    />
  );
}

export function DateField({
  value,
  onChange,
  min,
  max,
}: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
}) {
  return (
    <input
      type="date"
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(e.target.value)}
      className="field tnum"
    />
  );
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        inputMode="decimal"
        value={value ?? ''}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        className={cn('field tnum', suffix && 'pr-12')}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-ink-soft">
          {suffix}
        </span>
      )}
    </div>
  );
}

export function SelectField<T extends string>({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: T | '';
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string; group?: string }>;
  placeholder?: string;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, typeof options>();
    for (const option of options) {
      const key = option.group ?? '';
      map.set(key, [...(map.get(key) ?? []), option]);
    }
    return [...map.entries()];
  }, [options]);

  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="field appearance-none pr-10"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {grouped.map(([group, items]) =>
          group ? (
            <optgroup key={group} label={group}>
              {items.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ) : (
            items.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))
          ),
        )}
      </select>
      <ChevronDown
        size={16}
        className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-soft"
      />
    </div>
  );
}

/** Горизонтальна стрічка рахунків — швидше за випадний список. */
export function AccountPicker({
  accounts,
  value,
  onChange,
  exclude,
}: {
  accounts: Account[];
  value: string;
  onChange: (id: string) => void;
  exclude?: string;
}) {
  const visible = accounts.filter((a) => !a.isArchived && a.id !== exclude);

  return (
    <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {visible.map((account) => (
        <button
          key={account.id}
          type="button"
          onClick={() => onChange(account.id)}
          aria-pressed={value === account.id}
          className={cn(
            'flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2.5 transition-colors',
            value === account.id
              ? 'border-accent bg-accent/10 text-ink'
              : 'border-line bg-elevated text-ink-soft',
          )}
        >
          <span
            className="flex h-6 w-6 items-center justify-center rounded-lg"
            style={{ background: `${account.color}22`, color: account.color }}
          >
            <Icon name={account.icon} size={13} />
          </span>
          <span className="whitespace-nowrap text-sm">{account.name}</span>
          <span className="text-xs text-ink-faint">{account.currency}</span>
        </button>
      ))}
    </div>
  );
}

/** Категорії двома рівнями: батьки як вкладки, діти — плитками. */
export function CategoryPicker({
  categories,
  kind,
  value,
  onChange,
}: {
  categories: Category[];
  kind: 'income' | 'expense';
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const parents = categories.filter((c) => c.kind === kind && !c.parentId && !c.isArchived);
  const selected = categories.find((c) => c.id === value);
  const initialParent = selected?.parentId ?? selected?.id ?? parents[0]?.id ?? '';
  const [activeParent, setActiveParent] = useState(initialParent);
  const children = categories.filter((c) => c.parentId === activeParent && !c.isArchived);
  const listId = useId();

  if (parents.length === 0) {
    return <p className="text-xs text-ink-soft">Категорій ще немає — додайте їх у налаштуваннях.</p>;
  }

  return (
    <div>
      <div className="no-scrollbar -mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1">
        {parents.map((parent) => (
          <button
            key={parent.id}
            type="button"
            onClick={() => setActiveParent(parent.id)}
            aria-controls={listId}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              activeParent === parent.id ? 'bg-accent text-accent-ink' : 'bg-elevated text-ink-soft',
            )}
          >
            <Icon name={parent.icon} size={13} />
            {parent.name}
          </button>
        ))}
      </div>

      <div id={listId} className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {/* Батьківська категорія теж може бути вибором, якщо деталізація не потрібна. */}
        <PickerTile
          label="Уся категорія"
          icon={parents.find((p) => p.id === activeParent)?.icon ?? 'Circle'}
          color={parents.find((p) => p.id === activeParent)?.color ?? '#8b8f9a'}
          active={value === activeParent}
          onClick={() => onChange(activeParent)}
        />
        {children.map((child) => (
          <PickerTile
            key={child.id}
            label={child.name}
            icon={child.icon}
            color={child.color}
            active={value === child.id}
            onClick={() => onChange(child.id)}
          />
        ))}
      </div>
    </div>
  );
}

function PickerTile({
  label,
  icon,
  color,
  active,
  onClick,
}: {
  label: string;
  icon: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-2 rounded-xl border px-2.5 py-2.5 text-left transition-colors',
        active ? 'border-accent bg-accent/10' : 'border-line bg-elevated',
      )}
    >
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        style={{ background: `${color}22`, color }}
      >
        <Icon name={icon} size={14} />
      </span>
      <span className="min-w-0 truncate text-xs text-ink">{label}</span>
    </button>
  );
}
