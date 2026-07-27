"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
import { CalendarRange, Wallet, Tags, RotateCcw, Loader2 } from "lucide-react";

interface Option {
  id: string;
  name: string;
}

const PRESETS = [
  { key: "month", label: "Цей місяць" },
  { key: "prev", label: "Минулий" },
  { key: "30d", label: "30 днів" },
  { key: "quarter", label: "3 місяці" },
  { key: "year", label: "Рік" },
] as const;

function rangeFor(preset: string): { from: string; to: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  switch (preset) {
    case "prev": {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: iso(from), to: iso(to) };
    }
    case "30d":
      return { from: iso(new Date(now.getTime() - 29 * 86_400_000)), to: iso(now) };
    case "quarter":
      return { from: iso(new Date(now.getFullYear(), now.getMonth() - 2, 1)), to: iso(now) };
    case "year":
      return { from: iso(new Date(now.getFullYear(), 0, 1)), to: iso(now) };
    default:
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  }
}

export function FilterBar({
  accounts,
  categories,
}: {
  accounts: Option[];
  categories: Array<Option & { parentId: string | null }>;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const current = useMemo(
    () => ({
      from: params.get("from") ?? rangeFor("month").from,
      to: params.get("to") ?? rangeFor("month").to,
      accountId: params.get("accountId") ?? "",
      categoryId: params.get("categoryId") ?? "",
    }),
    [params],
  );

  const push = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      startTransition(() => router.push(`/?${next.toString()}`, { scroll: false }));
    },
    [params, router],
  );

  const activePreset = PRESETS.find((p) => {
    const r = rangeFor(p.key);
    return r.from === current.from && r.to === current.to;
  })?.key;

  // Підкатегорії показуємо з відступом під своїм батьком.
  const grouped = categories.filter((c) => !c.parentId);

  return (
    <div className="card sticky top-0 z-20 mb-6 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-canvas p-1">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => push(rangeFor(p.key))}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                activePreset === p.key
                  ? "bg-surface text-ink shadow-card"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 rounded-xl border border-line px-2.5 py-1.5">
          <CalendarRange size={15} className="shrink-0 text-ink-faint" />
          <input
            type="date"
            value={current.from}
            max={current.to}
            onChange={(e) => push({ from: e.target.value })}
            className="w-[7.5rem] bg-transparent text-xs text-ink"
            aria-label="Дата з"
          />
          <span className="text-ink-faint">—</span>
          <input
            type="date"
            value={current.to}
            min={current.from}
            onChange={(e) => push({ to: e.target.value })}
            className="w-[7.5rem] bg-transparent text-xs text-ink"
            aria-label="Дата по"
          />
        </div>

        <div className="flex items-center gap-1.5 rounded-xl border border-line px-2.5 py-1.5">
          <Wallet size={15} className="shrink-0 text-ink-faint" />
          <select
            value={current.accountId}
            onChange={(e) => push({ accountId: e.target.value })}
            className="max-w-[10rem] bg-transparent text-xs text-ink"
            aria-label="Рахунок"
          >
            <option value="">Усі рахунки</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5 rounded-xl border border-line px-2.5 py-1.5">
          <Tags size={15} className="shrink-0 text-ink-faint" />
          <select
            value={current.categoryId}
            onChange={(e) => push({ categoryId: e.target.value })}
            className="max-w-[11rem] bg-transparent text-xs text-ink"
            aria-label="Категорія"
          >
            <option value="">Усі категорії</option>
            {grouped.map((parent) => (
              <optgroup key={parent.id} label={parent.name}>
                <option value={parent.id}>{parent.name} — усе</option>
                {categories
                  .filter((c) => c.parentId === parent.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>

        {(current.accountId || current.categoryId || activePreset !== "month") && (
          <button
            onClick={() => startTransition(() => router.push("/", { scroll: false }))}
            className="btn-ghost px-2 py-1.5 text-xs"
          >
            <RotateCcw size={14} />
            Скинути
          </button>
        )}

        {pending && <Loader2 size={15} className="animate-spin text-ink-faint" />}
      </div>
    </div>
  );
}
