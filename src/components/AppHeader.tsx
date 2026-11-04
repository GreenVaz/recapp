import { Link } from 'react-router-dom';
import { Settings, User } from 'lucide-react';
import { useData } from '@/lib/store.tsx';

/** Верхній рядок екрана: заголовок і вхід у налаштування через профіль. */
export function AppHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const { me } = useData();
  const initial = (me?.displayName ?? me?.email ?? '?').trim().charAt(0).toUpperCase();

  return (
    <header className="mb-4 flex items-start justify-between gap-3 pt-safe">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 truncate text-xs text-ink-soft">{subtitle}</p>}
      </div>

      <Link
        to="/settings"
        aria-label="Налаштування"
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-elevated text-sm font-semibold text-ink-soft transition-colors hover:text-ink"
      >
        {initial === '?' ? <User size={16} /> : initial}
      </Link>
    </header>
  );
}

export function BackHeader({ title, to = '/settings' }: { title: string; to?: string }) {
  return (
    <header className="mb-4 flex items-center gap-2 pt-safe">
      <Link
        to={to}
        aria-label="Назад"
        className="-ml-2 flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-elevated hover:text-ink"
      >
        <Settings size={0} className="hidden" />
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M15 18l-6-6 6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </Link>
      <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
    </header>
  );
}
