import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/format.ts';

/**
 * Нижня шторка — основний спосіб показати деталі на телефоні.
 *
 * Чому саме вона: великий палець дістає до низу екрана, а верх у
 * шестидюймового телефона — ні. Висота обмежена 88vh, щоб під шторкою
 * лишався видимий фон і було зрозуміло, що це накладений шар.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    // Фон не має прокручуватися під відкритою шторкою.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    panelRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Закрити"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 animate-fade-in backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative z-10 flex max-h-[88vh] w-full flex-col rounded-t-3xl border border-line bg-surface',
          'animate-sheet-in sm:max-w-lg sm:rounded-3xl',
        )}
      >
        {/* Візуальний «хват» — підказує, що шторку можна закрити. */}
        <div className="flex justify-center pt-2.5 sm:hidden">
          <span className="h-1 w-9 rounded-full bg-line" />
        </div>

        <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-ink-soft">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити"
            className="-mr-2 -mt-1 rounded-xl p-2 text-ink-soft transition-colors hover:bg-elevated hover:text-ink"
          >
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>

        {footer && (
          <div className="border-t border-line px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
