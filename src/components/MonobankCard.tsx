import { useCallback, useEffect, useRef, useState } from 'react';
import { Building2, Link2, Loader2, RefreshCw, ShieldCheck, Unlink } from 'lucide-react';
import { api, ApiError } from '@/lib/api.js';
import { useData } from '@/lib/store.js';
import { Card, ErrorNote, SectionTitle } from '@/components/ui.js';

/**
 * Підключення Monobank.
 *
 * Історія тягнеться по одному вікну на хвилину — це обмеження банку, не
 * наше рішення, тому екран показує чесний залишок часу й дозволяє піти:
 * прогрес зберігається, і наступного разу довантаження продовжиться з того
 * самого місця.
 */

interface Status {
  connected: boolean;
  clientName?: string | null;
  webhookState?: string;
  lastError?: string | null;
  accounts?: number;
  windows?: { pending: number; done: number; failed: number };
  minutesLeft?: number;
}

interface SyncResult {
  status: 'more' | 'done' | 'waiting';
  inserted?: number;
  pending?: number;
  retryAfterSeconds?: number;
}

const DEPTHS = [
  { months: 3, label: '3 місяці' },
  { months: 6, label: '6 місяців' },
  { months: 12, label: 'Рік' },
];

export function MonobankCard() {
  const { reload } = useData();
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState('');
  const [months, setMonths] = useState(12);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [imported, setImported] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Довантаження живе довше за один рендер, тож його треба вміти зупинити,
  // коли користувач іде з екрана.
  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.get<Status>('/api/monobank'));
    } catch {
      setStatus({ connected: false });
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/monobank/connect', { token: token.trim(), months });
      setToken('');
      await refresh();
      await reload();
      void runSync();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не вдалося підключити');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm('Відключити Monobank? Рахунки й операції залишаться — зникне лише звʼязок із банком.')) return;
    setBusy(true);
    setError(null);
    try {
      cancelled.current = true;
      await api.del('/api/monobank');
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не вдалося відключити');
    } finally {
      cancelled.current = false;
      setBusy(false);
    }
  }

  /** Тягне вікна по черзі, поважаючи хвилинну паузу банку. */
  async function runSync() {
    if (syncing) return;
    cancelled.current = false;
    setSyncing(true);
    setError(null);
    setImported(0);

    try {
      for (;;) {
        if (cancelled.current) break;

        const result = await api.post<SyncResult>('/api/monobank/sync');
        if (result.status === 'done') {
          await refresh();
          await reload();
          break;
        }
        if (result.status === 'more') {
          setImported((n) => n + (result.inserted ?? 0));
          await refresh();
          await reload();
        }

        const wait = result.retryAfterSeconds ?? 60;
        for (let left = wait; left > 0; left -= 1) {
          if (cancelled.current) break;
          setCountdown(left);
          await sleep(1000);
        }
        setCountdown(0);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Довантаження перервалося');
    } finally {
      setSyncing(false);
      setCountdown(0);
    }
  }

  if (!status) return null;

  const pending = status.windows?.pending ?? 0;
  const done = status.windows?.done ?? 0;
  const total = pending + done;
  const percent = total > 0 ? Math.round((done / total) * 100) : 100;

  return (
    <Card className="mb-3">
      <SectionTitle title="Monobank" hint="Рахунки й виписки автоматично" />

      <ErrorNote message={error} />

      {!status.connected ? (
        <>
          <p className="mb-2 text-[0.8125rem] leading-relaxed text-ink-soft">
            Відкрийте{' '}
            <a
              href="https://api.monobank.ua/"
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent underline"
            >
              api.monobank.ua
            </a>{' '}
            у телефоні, зчитайте QR у застосунку банку і вставте отриманий токен сюди.
          </p>

          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Токен з api.monobank.ua"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            className="field text-sm"
          />

          <p className="mb-2 mt-3 text-xs text-ink-soft">Скільки історії завантажити</p>
          <div className="grid grid-cols-3 gap-2">
            {DEPTHS.map((d) => (
              <button
                key={d.months}
                type="button"
                onClick={() => setMonths(d.months)}
                className={months === d.months ? 'btn-primary' : 'btn-secondary'}
              >
                {d.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy || token.trim().length < 20}
            className="btn-primary mt-3 w-full disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
            Підключити
          </button>

          <p className="mt-2 flex items-start gap-1.5 text-[0.6875rem] leading-relaxed text-ink-faint">
            <ShieldCheck size={13} className="mt-0.5 shrink-0" />
            <span>
              Токен зберігається зашифрованим і ніколи не повертається у застосунок. Банк дозволяє
              один запит на хвилину, тому історія тягнеться поступово — вікно можна закрити, вона
              продовжиться наступного разу.
            </span>
          </p>
        </>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent">
              <Building2 size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink">{status.clientName ?? 'Monobank'}</p>
              <p className="text-xs text-ink-faint">
                {status.accounts ?? 0} рахунків ·{' '}
                {status.webhookState === 'active'
                  ? 'нові операції приходять самі'
                  : 'оновлення лише вручну'}
              </p>
            </div>
          </div>

          {total > 0 && (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-xs text-ink-soft">
                <span>Історія завантажена</span>
                <span className="tnum">{percent}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percent}%` }} />
              </div>
              {pending > 0 && (
                <p className="mt-1.5 text-[0.6875rem] text-ink-faint">
                  Лишилось {pending} {plural(pending)} — приблизно стільки ж хвилин, бо банк
                  дозволяє один запит на хвилину.
                </p>
              )}
            </div>
          )}

          {syncing && (
            <p className="mt-2 flex items-center gap-2 text-xs text-ink-soft">
              <Loader2 size={13} className="animate-spin" />
              {countdown > 0
                ? `Пауза банку: ${countdown} с${imported > 0 ? ` · додано ${imported}` : ''}`
                : 'Завантажую виписку…'}
            </p>
          )}

          {status.lastError && !error && (
            <p className="mt-2 text-[0.6875rem] text-expense">{status.lastError}</p>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => (syncing ? (cancelled.current = true) : void runSync())}
              disabled={busy || (pending === 0 && !syncing)}
              className="btn-secondary disabled:opacity-50"
            >
              <RefreshCw size={16} className={syncing ? 'animate-spin' : undefined} />
              {syncing ? 'Зупинити' : 'Довантажити'}
            </button>
            <button type="button" onClick={() => void disconnect()} disabled={busy} className="btn-secondary">
              <Unlink size={16} />
              Відключити
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

function plural(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'вікно';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'вікна';
  return 'вікон';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
