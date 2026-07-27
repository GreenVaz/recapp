import { ArrowDownRight, ArrowUpRight, PiggyBank, Wallet } from "lucide-react";
import { formatMoney } from "@/lib/money";
import type { Analytics } from "@/lib/analytics";

export function KpiRow({ kpi, currency }: { kpi: Analytics["kpi"]; currency: string }) {
  const items = [
    {
      label: "Чистий капітал",
      value: formatMoney(kpi.netWorth, currency),
      icon: Wallet,
      tone: "text-ink",
      hint: "усі активні рахунки",
    },
    {
      label: "Доходи",
      value: formatMoney(kpi.income, currency),
      icon: ArrowUpRight,
      tone: "text-positive",
      hint: `${kpi.transactionCount} операцій за період`,
    },
    {
      label: "Витрати",
      value: formatMoney(kpi.expense, currency),
      icon: ArrowDownRight,
      tone: "text-negative",
      hint: "за обраний період",
    },
    {
      label: "Заощаджено",
      value: formatMoney(kpi.net, currency, { sign: true }),
      icon: PiggyBank,
      tone: kpi.net >= 0 ? "text-positive" : "text-negative",
      hint: `норма заощадження ${kpi.savingsRate.toFixed(0)}%`,
    },
  ];

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs text-ink-soft">{item.label}</p>
            <item.icon size={15} className={item.tone} strokeWidth={2} />
          </div>
          <p className={`tabular text-lg font-semibold tracking-tight ${item.tone}`}>{item.value}</p>
          <p className="mt-0.5 truncate text-[0.6875rem] text-ink-faint">{item.hint}</p>
        </div>
      ))}
    </div>
  );
}
