import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronRight,
  Download,
  LogOut,
  Moon,
  Sun,
  SunMoon,
  Tags,
  Trash2,
  Upload,
  Wallet,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api.js';
import { useData } from '@/lib/store.js';
import { useTheme } from '@/lib/theme.js';
import { AppHeader } from '@/components/AppHeader.js';
import { Card, ErrorNote, FullScreenLoader, SectionTitle, Segmented } from '@/components/ui.js';
import { MonobankCard } from '@/components/MonobankCard.js';
import { Sheet } from '@/components/Sheet.js';
import { Field, NumberField, SelectField, TextField } from '@/components/fields.js';

interface ImportReport {
  applied: boolean;
  willAdd: Record<string, number>;
  duplicates: Record<string, number>;
  skipped: Record<string, number>;
  warnings: string[];
}

export function SettingsScreen() {
  const { data, me, run, signOut, reload } = useData();
  const { theme, setTheme } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [pendingBackup, setPendingBackup] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!data) return <FullScreenLoader />;

  async function updateSettings(patch: Record<string, unknown>) {
    setError(null);
    try {
      await run(() => api.patch('/api/settings', patch));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не вдалося зберегти');
    }
  }

  function download(content: string, filename: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function exportData(format: 'json' | 'csv') {
    setError(null);
    try {
      const response = await fetch(`/api/export?format=${format}`, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Не вдалося вивантажити дані');
      const text = await response.text();
      const stamp = new Date().toISOString().slice(0, 10);
      download(
        text,
        format === 'csv' ? `transactions-${stamp}.csv` : `finance-backup-${stamp}.json`,
        format === 'csv' ? 'text/csv' : 'application/json',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося вивантажити');
    }
  }

  async function pickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setError(null);
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      // Спершу тільки перегляд — жодних змін, доки користувач не підтвердить.
      const report = await api.post<ImportReport>('/api/import', { mode: 'preview', payload });
      setPendingBackup(payload);
      setImportReport(report);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Файл не схожий на резервну копію');
    }
  }

  async function applyImport() {
    if (!pendingBackup) return;
    setError(null);
    try {
      const report = await run(() =>
        api.post<ImportReport>('/api/import', { mode: 'apply', payload: pendingBackup }),
      );
      setImportReport(null);
      setPendingBackup(null);
      const total = Object.values(report.willAdd).reduce((s, n) => s + n, 0);
      setNotice(`Імпортовано записів: ${total}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не вдалося імпортувати');
    }
  }

  async function deleteAccount() {
    const confirmation = prompt('Усі дані буде видалено назавжди. Введіть ВИДАЛИТИ для підтвердження:');
    if (confirmation !== 'ВИДАЛИТИ') return;
    try {
      await api.del('/api/auth/account');
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не вдалося видалити акаунт');
    }
  }

  return (
    <main className="page">
      <AppHeader title="Налаштування" subtitle={me?.email ?? undefined} />

      <ErrorNote message={error} />
      {notice && (
        <p className="mb-3 rounded-xl bg-income/10 px-3 py-2 text-xs text-income">{notice}</p>
      )}

      <Card className="mb-3">
        <SectionTitle title="Вигляд" />
        <Segmented
          value={theme}
          onChange={(next) => {
            setTheme(next);
            void updateSettings({ theme: next });
          }}
          className="w-full"
          options={[
            { value: 'dark', label: 'Темна' },
            { value: 'light', label: 'Світла' },
            { value: 'system', label: 'Системна' },
          ]}
        />
        <p className="mt-2 flex items-center gap-1.5 text-[0.6875rem] text-ink-faint">
          {theme === 'dark' ? <Moon size={12} /> : theme === 'light' ? <Sun size={12} /> : <SunMoon size={12} />}
          Тема застосовується одразу на всіх екранах
        </p>
      </Card>

      <Card className="mb-3">
        <SectionTitle title="Гроші" />
        <div className="space-y-3">
          <Field label="Основна валюта" hint="У ній рахуються підсумки й прогноз">
            <SelectField
              value={data.settings.baseCurrency}
              onChange={(value) => void updateSettings({ baseCurrency: value })}
              options={[
                { value: 'UAH', label: 'UAH — гривня' },
                { value: 'USD', label: 'USD — долар' },
                { value: 'EUR', label: 'EUR — євро' },
              ]}
            />
          </Field>

          <RatesEditor />
        </div>
      </Card>

      <Card className="mb-3 p-0">
        <NavRow to="/settings/accounts" icon={<Wallet size={17} />} label="Рахунки" value={`${data.accounts.length}`} />
        <NavRow
          to="/settings/categories"
          icon={<Tags size={17} />}
          label="Категорії"
          value={`${data.categories.length}`}
        />
      </Card>

      <Card className="mb-3">
        <SectionTitle title="Профіль" />
        <div className="space-y-3">
          <Field label="Ім’я">
            <TextField
              value={data.displayName ?? ''}
              onChange={(value) => void updateSettings({ displayName: value || null })}
              placeholder="Як до вас звертатися"
              maxLength={80}
            />
          </Field>

          <button type="button" onClick={() => setPasswordOpen(true)} className="btn-secondary w-full">
            Змінити пароль
          </button>
        </div>
      </Card>

      <MonobankCard />

      <Card className="mb-3">
        <SectionTitle title="Дані" hint="Резервна копія і перенесення" />
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => void exportData('json')} className="btn-secondary">
            <Download size={16} />
            JSON
          </button>
          <button type="button" onClick={() => void exportData('csv')} className="btn-secondary">
            <Download size={16} />
            CSV
          </button>
        </div>

        <button type="button" onClick={() => fileRef.current?.click()} className="btn-secondary mt-2 w-full">
          <Upload size={16} />
          Імпортувати копію
        </button>
        <input ref={fileRef} type="file" accept="application/json" onChange={pickFile} className="hidden" />

        <p className="mt-2 text-[0.6875rem] leading-relaxed text-ink-faint">
          Перед застосуванням імпорт показує, що саме буде додано. Записи звіряються за змістом, тож
          повторний імпорт того самого файлу нічого не подвоїть.
        </p>
      </Card>

      <Card className="mb-3">
        <button type="button" onClick={() => void signOut()} className="btn-secondary w-full">
          <LogOut size={16} />
          Вийти
        </button>
        <button type="button" onClick={deleteAccount} className="btn-danger mt-2 w-full">
          <Trash2 size={16} />
          Видалити акаунт і всі дані
        </button>
      </Card>

      {passwordOpen && <PasswordSheet onClose={() => setPasswordOpen(false)} />}

      {importReport && (
        <Sheet
          open
          onClose={() => {
            setImportReport(null);
            setPendingBackup(null);
          }}
          title="Що буде імпортовано"
          footer={
            <button type="button" onClick={applyImport} className="btn-primary w-full">
              Застосувати імпорт
            </button>
          }
        >
          <dl className="space-y-2 text-sm">
            {Object.entries(importReport.willAdd).map(([key, count]) => (
              <div key={key} className="flex justify-between">
                <dt className="text-ink-soft">{LABELS[key] ?? key}</dt>
                <dd className="tnum font-medium">{count}</dd>
              </div>
            ))}
          </dl>

          {Object.values(importReport.duplicates).some((n) => n > 0) && (
            <p className="mt-3 rounded-xl bg-elevated px-3 py-2 text-xs text-ink-soft">
              Дублікатів пропущено:{' '}
              {Object.entries(importReport.duplicates)
                .filter(([, n]) => n > 0)
                .map(([key, n]) => `${LABELS[key] ?? key} — ${n}`)
                .join(', ')}
            </p>
          )}

          {Object.values(importReport.skipped).some((n) => n > 0) && (
            <p className="mt-2 rounded-xl bg-debt/10 px-3 py-2 text-xs text-debt">
              Пропущено через відсутні зв’язки:{' '}
              {Object.entries(importReport.skipped)
                .filter(([, n]) => n > 0)
                .map(([key, n]) => `${LABELS[key] ?? key} — ${n}`)
                .join(', ')}
            </p>
          )}

          {importReport.warnings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {importReport.warnings.map((warning) => (
                <li key={warning} className="text-xs text-ink-faint">
                  • {warning}
                </li>
              ))}
            </ul>
          )}
        </Sheet>
      )}
    </main>
  );
}

const LABELS: Record<string, string> = {
  accounts: 'Рахунки',
  categories: 'Категорії',
  transactions: 'Операції',
  recurringRules: 'Регулярні правила',
  loans: 'Кредити',
};

function NavRow({
  to,
  icon,
  label,
  value,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  value?: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 border-b border-line px-4 py-3.5 last:border-0 active:bg-elevated"
    >
      <span className="text-ink-soft">{icon}</span>
      <span className="flex-1 text-sm">{label}</span>
      {value && <span className="tnum text-sm text-ink-faint">{value}</span>}
      <ChevronRight size={16} className="text-ink-faint" />
    </Link>
  );
}

function RatesEditor() {
  const { data, run, baseCurrency } = useData();
  const [drafts, setDrafts] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);

  const others = ['UAH', 'USD', 'EUR'].filter((c) => c !== baseCurrency);

  function rateFor(currency: string): number | null {
    const direct = data?.rates.find((r) => r.base === currency && r.quote === baseCurrency);
    if (direct) return direct.rate;
    const inverse = data?.rates.find((r) => r.base === baseCurrency && r.quote === currency);
    return inverse && inverse.rate !== 0 ? Number((1 / inverse.rate).toFixed(4)) : null;
  }

  async function save() {
    setBusy(true);
    try {
      const rates = others
        .map((currency) => ({
          base: currency,
          quote: baseCurrency,
          rate: drafts[currency] ?? rateFor(currency),
        }))
        .filter((r): r is { base: string; quote: string; rate: number } => Boolean(r.rate && r.rate > 0));

      await run(() => api.put('/api/settings/rates', { rates }));
      setDrafts({});
    } finally {
      setBusy(false);
    }
  }

  const changed = Object.keys(drafts).length > 0;

  return (
    <div>
      <span className="label">Курси валют</span>
      <div className="space-y-2">
        {others.map((currency) => (
          <div key={currency} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-sm text-ink-soft">1 {currency}</span>
            <span className="text-ink-faint">=</span>
            <div className="min-w-0 flex-1">
              <NumberField
                value={drafts[currency] ?? rateFor(currency)}
                onChange={(value) => setDrafts({ ...drafts, [currency]: value })}
                min={0}
                step={0.01}
                suffix={baseCurrency}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="mt-1.5 text-[0.6875rem] text-ink-faint">
        Без курсу суми в цій валюті не потраплять у підсумки — застосунок покаже попередження, а не
        складе різні валюти як рівні.
      </p>

      {changed && (
        <button type="button" onClick={save} disabled={busy} className="btn-secondary mt-2 w-full">
          {busy ? 'Зберігаємо…' : 'Зберегти курси'}
        </button>
      )}
    </div>
  );
}

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/password', { currentPassword, newPassword });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не вдалося змінити пароль');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Зміна пароля"
      description="Інші пристрої вийдуть із системи"
      footer={
        <button
          type="button"
          onClick={submit}
          disabled={busy || newPassword.length < 8}
          className="btn-primary w-full"
        >
          {busy ? 'Зберігаємо…' : 'Змінити пароль'}
        </button>
      }
    >
      <div className="space-y-4">
        <Field label="Поточний пароль">
          <TextField value={currentPassword} onChange={setCurrentPassword} type="password" />
        </Field>
        <Field label="Новий пароль" hint="Щонайменше 8 символів">
          <TextField value={newPassword} onChange={setNewPassword} type="password" />
        </Field>
        <ErrorNote message={error} />
      </div>
    </Sheet>
  );
}
