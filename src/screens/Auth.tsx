import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { api, ApiError } from '@/lib/api.js';
import { useData } from '@/lib/store.js';
import { Field, TextField } from '@/components/fields.js';
import { ErrorNote, Segmented } from '@/components/ui.js';

type Mode = 'login' | 'register';

export function AuthScreen() {
  const { reload } = useData();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.post(`/api/auth/${mode}`, { email: email.trim(), password });
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не вдалося увійти');
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (!email.trim()) {
      setError('Спершу вкажіть пошту');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ message: string; warning?: string }>('/api/auth/forgot', {
        email: email.trim(),
      });
      // Якщо доставку не налаштовано, сервер каже про це прямо.
      setNotice(result.warning ?? result.message);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не вдалося надіслати лист');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6 py-10">
      <div className="mb-8 text-center">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-glow">
          <Wallet size={26} strokeWidth={2.2} />
        </span>
        <h1 className="text-xl font-semibold tracking-tight">Фінансовий календар</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          Плануйте витрати й бачте залишок на будь-яку дату
        </p>
      </div>

      <Segmented
        value={mode}
        onChange={(next) => {
          setMode(next);
          setError(null);
          setNotice(null);
        }}
        options={[
          { value: 'login', label: 'Вхід' },
          { value: 'register', label: 'Реєстрація' },
        ]}
        className="mb-5 w-full"
      />

      <form onSubmit={submit} className="space-y-4">
        <Field label="Пошта">
          <TextField
            value={email}
            onChange={setEmail}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@example.com"
          />
        </Field>

        <Field label="Пароль" hint={mode === 'register' ? 'Щонайменше 8 символів' : undefined}>
          <TextField
            value={password}
            onChange={setPassword}
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            placeholder="••••••••"
          />
        </Field>

        <ErrorNote message={error} />
        {notice && (
          <p className="rounded-xl bg-accent/10 px-3 py-2 text-xs leading-relaxed text-accent">{notice}</p>
        )}

        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? 'Зачекайте…' : mode === 'login' ? 'Увійти' : 'Створити акаунт'}
        </button>
      </form>

      {mode === 'login' && (
        <button type="button" onClick={forgot} disabled={busy} className="btn-ghost mt-3 w-full text-xs">
          Забули пароль?
        </button>
      )}

      <p className="mt-8 text-center text-[0.6875rem] leading-relaxed text-ink-faint">
        Дані зберігаються у вашій базі й доступні лише вам.
      </p>
    </main>
  );
}
