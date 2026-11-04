import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney } from '@core/money.ts';
import { formatShortDate } from '@/lib/format.ts';

/**
 * Графік залишку. Винесений в окремий модуль і підвантажується ліниво:
 * recharts важить понад 400 КБ, і тримати його в першому завантаженні
 * заради одного блоку на головній — марна трата мобільного трафіку.
 */
export default function BalanceChart({
  data,
  currency,
}: {
  data: Array<{ date: string; label: string; value: number }>;
  currency: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--c-accent))" stopOpacity={0.35} />
            <stop offset="100%" stopColor="rgb(var(--c-accent))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fill: 'rgb(var(--c-ink-faint))', fontSize: 10 }}
          interval="preserveStartEnd"
          minTickGap={28}
        />
        <YAxis hide domain={['auto', 'auto']} />
        <ReferenceLine y={0} stroke="rgb(var(--c-expense))" strokeDasharray="3 3" />
        <Tooltip
          cursor={{ stroke: 'rgb(var(--c-line))' }}
          content={({ active, payload }) =>
            active && payload?.[0] ? (
              <div className="rounded-xl border border-line bg-surface px-3 py-2 shadow-pop">
                <p className="text-[0.6875rem] text-ink-soft">
                  {formatShortDate(String(payload[0].payload.date))}
                </p>
                <p className="tnum text-sm font-semibold">
                  {formatMoney(Number(payload[0].value), currency)}
                </p>
              </div>
            ) : null
          }
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="rgb(var(--c-accent))"
          strokeWidth={2}
          fill="url(#balanceFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
