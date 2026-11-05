import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import {
  ArrowLeftRight,
  CalendarDays,
  ChartPie,
  Landmark,
  Minus,
  Plus,
  Scale,
  TrendingUp,
  House,
  CalendarClock,
} from 'lucide-react';
import { cn } from '@/lib/format.js';
import { Sheet } from './Sheet.js';

const TABS = [
  { to: '/', label: 'Головна', icon: House, end: true },
  { to: '/calendar', label: 'Календар', icon: CalendarDays },
  { to: '/loans', label: 'Кредити', icon: Landmark },
  { to: '/analytics', label: 'Аналітика', icon: ChartPie },
] as const;

const QUICK_ACTIONS = [
  { to: '/new/expense', label: 'Витрата', hint: 'Разова або планова', icon: Minus, tone: 'expense' },
  { to: '/new/income', label: 'Дохід', hint: 'Надходження коштів', icon: Plus, tone: 'income' },
  { to: '/new/recurring', label: 'Планова операція', hint: 'Повторюється за розкладом', icon: CalendarClock, tone: 'accent' },
  { to: '/new/loan', label: 'Кредит або розстрочка', hint: 'З графіком погашення', icon: Landmark, tone: 'debt' },
  { to: '/new/transfer', label: 'Переказ', hint: 'Між власними рахунками', icon: ArrowLeftRight, tone: 'accent' },
  { to: '/new/adjust', label: 'Коригування балансу', hint: 'Привести залишок до факту', icon: Scale, tone: 'accent' },
] as const;

const TONE_CLASS: Record<string, string> = {
  expense: 'bg-expense/12 text-expense',
  income: 'bg-income/12 text-income',
  debt: 'bg-debt/12 text-debt',
  accent: 'bg-accent/12 text-accent',
};

export function BottomNav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <>
      <nav
        aria-label="Основна навігація"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-safe backdrop-blur-xl"
      >
        <div className="mx-auto grid max-w-2xl grid-cols-5 items-center px-1">
          {TABS.slice(0, 2).map((tab) => (
            <Tab key={tab.to} {...tab} />
          ))}

          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Додати операцію"
              aria-haspopup="dialog"
              className="-mt-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-glow transition-transform active:scale-95"
            >
              <Plus size={24} strokeWidth={2.4} />
            </button>
          </div>

          {TABS.slice(2).map((tab) => (
            <Tab key={tab.to} {...tab} />
          ))}
        </div>
      </nav>

      <Sheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Що додаємо?"
        description="Операція потрапить у календар і прогноз"
      >
        <ul className="space-y-1.5">
          {QUICK_ACTIONS.map((action) => (
            <li key={action.to}>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  navigate(action.to, { state: { from: location.pathname } });
                }}
                className="flex w-full items-center gap-3 rounded-2xl border border-line bg-elevated p-3 text-left transition-colors active:bg-line/60"
              >
                <span
                  className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                    TONE_CLASS[action.tone],
                  )}
                >
                  <action.icon size={18} strokeWidth={2.2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.9375rem] font-medium text-ink">
                    {action.label}
                  </span>
                  <span className="block truncate text-xs text-ink-soft">{action.hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  );
}

function Tab({
  to,
  label,
  icon: IconComponent,
  end,
}: {
  to: string;
  label: string;
  icon: typeof TrendingUp;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          // Знизу відступ менший: під ним уже є безпечна зона під домашній
          // індикатор, і симетричний padding робив смугу зайво високою.
          'flex flex-col items-center gap-1 pb-1.5 pt-2.5 text-[0.625rem] font-medium transition-colors',
          isActive ? 'text-accent' : 'text-ink-faint',
        )
      }
    >
      {({ isActive }) => (
        <>
          <IconComponent size={21} strokeWidth={isActive ? 2.3 : 1.9} />
          {label}
        </>
      )}
    </NavLink>
  );
}
