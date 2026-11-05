import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { addMonths, endOfMonth, startOfMonth, today as todayISO, type DateISO } from '@core/dates.js';
import { forecast, type ForecastResult } from '@core/forecast.js';
import type { RateTable } from '@core/money.js';
import { api, ApiError } from './api.js';
import type { Bootstrap, Ledger, Me } from './types.js';

/**
 * Єдине джерело даних для всього інтерфейсу.
 *
 * Сервер віддає сирі факти, а щоденний прогноз рахується тут — одним
 * викликом рушія. Календар, головний екран і аналітика читають один і
 * той самий ForecastResult, тож показати різні числа на різних екранах
 * технічно неможливо.
 */

type Status = 'loading' | 'anonymous' | 'ready' | 'error';

interface DataValue {
  status: Status;
  error: string | null;
  me: Me | null;
  data: Bootstrap | null;
  ledger: Ledger | null;
  forecastResult: ForecastResult | null;
  rates: RateTable;
  baseCurrency: string;
  today: DateISO;
  isOffline: boolean;
  /** Розширює завантажений діапазон, якщо користувач вийшов за його межі. */
  ensureRange(from: DateISO, to: DateISO): void;
  reload(): Promise<void>;
  /** Виконує зміну і перезавантажує дані. */
  run<T>(action: () => Promise<T>): Promise<T>;
  signOut(): Promise<void>;
  setMe(me: Me | null): void;
}

const DataContext = createContext<DataValue | null>(null);

function defaultRange(today: DateISO): { from: DateISO; to: DateISO } {
  // Назад — щоб календар і аналітика мали історію, вперед — на горизонт прогнозу.
  return {
    from: startOfMonth(addMonths(today, -6) ?? today),
    to: endOfMonth(addMonths(today, 12) ?? today),
  };
}

export function DataProvider({ children }: { children: ReactNode }) {
  const today = useMemo(() => todayISO(), []);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [data, setData] = useState<Bootstrap | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [range, setRange] = useState(() => defaultRange(today));
  const [isOffline, setIsOffline] = useState(() => !navigator.onLine);

  const rangeRef = useRef(range);
  rangeRef.current = range;

  useEffect(() => {
    const online = () => setIsOffline(false);
    const offline = () => setIsOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  const load = useCallback(async (next = rangeRef.current) => {
    try {
      const profile = await api.get<Me>('/api/auth/me');
      setMe(profile);

      const [bootstrap, ledgerData] = await Promise.all([
        api.get<Bootstrap>('/api/bootstrap'),
        api.get<Ledger>(`/api/ledger?from=${next.from}&to=${next.to}`),
      ]);

      setData(bootstrap);
      setLedger(ledgerData);
      setError(null);
      setStatus('ready');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setMe(null);
        setData(null);
        setLedger(null);
        setStatus('anonymous');
        return;
      }
      setError(e instanceof Error ? e.message : 'Не вдалося завантажити дані');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const ensureRange = useCallback(
    (from: DateISO, to: DateISO) => {
      const current = rangeRef.current;
      if (from >= current.from && to <= current.to) return;

      const next = {
        from: from < current.from ? startOfMonth(from) : current.from,
        to: to > current.to ? endOfMonth(to) : current.to,
      };
      setRange(next);
      rangeRef.current = next;
      void load(next);
    },
    [load],
  );

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      const result = await action();
      await load();
      return result;
    },
    [load],
  );

  const signOut = useCallback(async () => {
    await api.post('/api/auth/logout');
    setMe(null);
    setData(null);
    setLedger(null);
    setStatus('anonymous');
  }, []);

  const rates = useMemo<RateTable>(() => {
    const table: Record<string, number> = {};
    const base = data?.settings.baseCurrency ?? 'UAH';
    for (const row of data?.rates ?? []) {
      if (row.quote === base) table[row.base] = row.rate;
      else if (row.base === base && row.rate !== 0) table[row.quote] = 1 / row.rate;
    }
    table[base] = 1;
    return table;
  }, [data]);

  const forecastResult = useMemo(() => {
    if (!data || !ledger) return null;
    return forecast({
      from: ledger.from,
      to: ledger.to,
      today,
      baseCurrency: data.settings.baseCurrency,
      rates,
      accounts: data.accounts
        .filter((a) => !a.isArchived)
        .map((a) => ({ id: a.id, currency: a.currency, balance: a.balance })),
      transactions: ledger.transactions,
      rules: ledger.rules,
      exceptions: ledger.exceptions,
      loanDues: ledger.loanDues,
    });
  }, [data, ledger, rates, today]);

  const value: DataValue = {
    status,
    error,
    me,
    data,
    ledger,
    forecastResult,
    rates,
    baseCurrency: data?.settings.baseCurrency ?? 'UAH',
    today,
    isOffline,
    ensureRange,
    reload: load,
    run,
    signOut,
    setMe,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataValue {
  const value = useContext(DataContext);
  if (!value) throw new Error('useData має викликатися всередині DataProvider');
  return value;
}

/** Зручний доступ до завантаженого робочого простору на захищених екранах. */
export function useWorkspace() {
  const ctx = useData();
  if (!ctx.data || !ctx.forecastResult) {
    throw new Error('Робочий простір ще не завантажено');
  }
  return { ...ctx, data: ctx.data, forecastResult: ctx.forecastResult };
}
