"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Wallet,
  Target,
  Tags,
  CalendarClock,
  Settings,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/", label: "Дашборд", icon: LayoutDashboard },
  { href: "/transactions", label: "Транзакції", icon: ArrowLeftRight },
  { href: "/accounts", label: "Рахунки", icon: Wallet },
  { href: "/budgets", label: "Бюджети", icon: Target },
  { href: "/recurring", label: "Регулярні", icon: CalendarClock },
  { href: "/categories", label: "Категорії", icon: Tags },
  { href: "/settings", label: "Налаштування", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const links = (
    <nav className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, icon: IconCmp }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setOpen(false)}
            className={cn(
              "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors duration-150",
              active
                ? "bg-accent-soft font-medium text-accent"
                : "text-ink-soft hover:bg-canvas hover:text-ink",
            )}
          >
            <IconCmp size={17} strokeWidth={active ? 2.1 : 1.8} />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Мобільний хедер */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
        <span className="text-sm font-semibold tracking-tight">Фінанси</span>
        <button onClick={() => setOpen(true)} className="btn-ghost p-1.5" aria-label="Меню">
          <Menu size={20} />
        </button>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/20 animate-fade-in" onClick={() => setOpen(false)} />
          <aside className="relative z-10 h-full w-64 border-r border-line bg-surface p-4 animate-fade-in">
            <div className="mb-6 flex items-center justify-between">
              <Brand />
              <button onClick={() => setOpen(false)} className="btn-ghost p-1.5" aria-label="Закрити">
                <X size={18} />
              </button>
            </div>
            {links}
          </aside>
        </div>
      )}

      <aside className="fixed left-0 top-0 hidden h-screen w-60 flex-col border-r border-line bg-surface px-4 py-6 lg:flex">
        <div className="mb-8 px-1">
          <Brand />
        </div>
        {links}
        <p className="mt-auto px-3 text-[0.6875rem] leading-relaxed text-ink-faint">
          Дані зберігаються локально.
          <br />
          Токени зашифровані.
        </p>
      </aside>
    </>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-ink">
        <Wallet size={16} className="text-white" strokeWidth={2} />
      </div>
      <div className="leading-tight">
        <p className="text-sm font-semibold tracking-tight">Фінанси</p>
        <p className="text-[0.6875rem] text-ink-faint">особистий облік</p>
      </div>
    </div>
  );
}
