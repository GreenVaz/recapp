import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/format.js';

export function Card({
  className,
  children,
  as: Tag = 'section',
}: {
  className?: string;
  children: ReactNode;
  as?: 'section' | 'div' | 'article';
}) {
  return <Tag className={cn('card p-4', className)}>{children}</Tag>;
}

export function SectionTitle({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-ink-soft">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('animate-spin text-ink-faint', className)} size={18} />;
}

export function FullScreenLoader({ label = 'Завантаження…' }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
      <Spinner className="h-6 w-6" />
      <p className="text-sm text-ink-soft">{label}</p>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="mb-1 text-ink-faint">{icon}</div>}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="max-w-xs text-xs leading-relaxed text-ink-soft">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Перемикач на 2–5 варіантів. На телефоні зручніший за випадний список. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    // overflow-x-auto обов'язковий: п'ять варіантів із довгими підписами не
    // влазять у 320px і інакше розпирали б усю сторінку горизонтально.
    <div
      className={cn(
        'no-scrollbar inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-elevated p-1',
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            'flex-1 shrink-0 whitespace-nowrap rounded-lg font-medium transition-colors',
            size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-2 text-[0.8125rem]',
            value === option.value
              ? 'bg-surface text-ink shadow-card'
              : 'text-ink-soft hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Progress({
  value,
  tone = 'accent',
  className,
}: {
  /** Відсоток 0..100+; понад 100 зафарбовує смугу повністю. */
  value: number;
  tone?: 'accent' | 'income' | 'expense' | 'debt';
  className?: string;
}) {
  const palette = {
    accent: 'bg-accent',
    income: 'bg-income',
    expense: 'bg-expense',
    debt: 'bg-debt',
  } as const;

  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-line', className)}>
      <div
        className={cn('h-full rounded-full transition-[width] duration-500 ease-out', palette[tone])}
        style={{ width: `${Math.max(0, Math.min(value, 100))}%` }}
      />
    </div>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl bg-expense/10 px-3 py-2 text-xs text-expense">
      {message}
    </p>
  );
}
