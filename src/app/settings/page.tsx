"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Key,
  Landmark,
  Link2,
  Link2Off,
  Loader2,
  RefreshCw,
  Smartphone,
  Trash2,
} from "lucide-react";
import { api, del, patch, post } from "@/lib/client";
import { formatMoney } from "@/lib/money";
import { CURRENCIES } from "@/lib/constants";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardHeader } from "@/components/ui/Card";
import type { AccountDTO, MonoAccountDTO, SettingsDTO } from "@/types";

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [accounts, setAccounts] = useState<AccountDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [s, a] = await Promise.all([
      api<SettingsDTO>("/api/settings"),
      api<AccountDTO[]>("/api/accounts"),
    ]);
    setSettings(s);
    setAccounts(a);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !settings) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 size={20} className="animate-spin text-ink-faint" />
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Налаштування" subtitle="Валюти, інтеграції та доступ" />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <GeneralCard settings={settings} accounts={accounts} onSaved={load} />
        <ApiKeyCard settings={settings} onSaved={load} />
        <MonobankCard settings={settings} accounts={accounts} onSaved={load} />
      </div>
    </>
  );
}

/* ── Загальні ────────────────────────────────────────────────────────── */

function GeneralCard({
  settings,
  accounts,
  onSaved,
}: {
  settings: SettingsDTO;
  accounts: AccountDTO[];
  onSaved: () => Promise<void>;
}) {
  const [baseCurrency, setBaseCurrency] = useState(settings.baseCurrency);
  const [defaultAccountId, setDefaultAccountId] = useState(settings.defaultAccountId ?? "");
  const [rates, setRates] = useState(
    Object.fromEntries(settings.rates.map((r) => [`${r.base}/${r.quote}`, String(r.rate)])),
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await patch("/api/settings", {
        baseCurrency,
        defaultAccountId: defaultAccountId || null,
        rates: Object.entries(rates)
          .map(([pair, value]) => {
            const [base, quote] = pair.split("/");
            return { base, quote, rate: Number(value) };
          })
          .filter((r) => Number.isFinite(r.rate) && r.rate > 0),
      });
      await onSaved();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Загальні" subtitle="Базова валюта звітності та курси" />

      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="base-currency">
              Базова валюта
            </label>
            <select
              id="base-currency"
              className="field"
              value={baseCurrency}
              onChange={(e) => setBaseCurrency(e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[0.6875rem] text-ink-faint">
              У ній рахуються дашборд і бюджети.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="default-account">
              Рахунок за замовчуванням
            </label>
            <select
              id="default-account"
              className="field"
              value={defaultAccountId}
              onChange={(e) => setDefaultAccountId(e.target.value)}
            >
              <option value="">— перший активний —</option>
              {accounts
                .filter((a) => !a.isArchived)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
            <p className="mt-1.5 text-[0.6875rem] text-ink-faint">
              Використовується Fast-Entry API, коли рахунок не вказано.
            </p>
          </div>
        </div>

        <div>
          <span className="label">Курси валют</span>
          <div className="space-y-2">
            {settings.rates.map((r) => (
              <div key={r.id} className="flex items-center gap-2">
                <span className="w-20 text-xs text-ink-soft">
                  1 {r.base} =
                </span>
                <input
                  className="field tabular w-28 py-1.5 text-xs"
                  inputMode="decimal"
                  value={rates[`${r.base}/${r.quote}`] ?? ""}
                  onChange={(e) => setRates({ ...rates, [`${r.base}/${r.quote}`]: e.target.value })}
                  aria-label={`Курс ${r.base} до ${r.quote}`}
                />
                <span className="text-xs text-ink-soft">{r.quote}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[0.6875rem] text-ink-faint">
            Курси вводяться вручну — так зведені показники залишаються передбачуваними.
          </p>
        </div>

        <button onClick={save} className="btn-primary w-full" disabled={saving}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : saved ? <Check size={15} /> : null}
          {saving ? "Збереження…" : saved ? "Збережено" : "Зберегти"}
        </button>
      </div>
    </Card>
  );
}

/* ── API-ключ для iOS Shortcuts ──────────────────────────────────────── */

function ApiKeyCard({ settings, onSaved }: { settings: SettingsDTO; onSaved: () => Promise<void> }) {
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    if (!settings.hasApiKey) {
      setKey(null);
      return;
    }
    void api<{ key: string | null }>("/api/settings/api-key").then((d) => setKey(d.key));
  }, [settings.hasApiKey]);

  async function generate() {
    setBusy(true);
    try {
      const res = await post<{ key: string }>("/api/settings/api-key", {});
      setKey(res.key);
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!confirm("Відкликати ключ? Наявні Shortcuts перестануть працювати.")) return;
    setBusy(true);
    try {
      await del("/api/settings/api-key");
      setKey(null);
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  function copy(text: string, label: string) {
    void navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1800);
  }

  const quickUrl = key ? `${origin}/api/quick-entry?key=${key}&amount=100&note=Кава` : "";

  return (
    <Card>
      <CardHeader
        title="Швидке додавання з iPhone"
        subtitle="Apple Shortcuts / Siri через REST API"
        action={<Smartphone size={16} className="text-ink-faint" />}
      />

      {!key ? (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-ink-soft">
            Згенеруйте персональний ключ — і зможете додавати витрати одним дотиком
            через «Команди» або голосом через Siri.
          </p>
          <button onClick={generate} className="btn-primary w-full" disabled={busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Key size={15} />}
            Згенерувати ключ
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <span className="label">API-ключ</span>
            <div className="flex gap-2">
              <code className="flex-1 truncate rounded-xl bg-canvas px-3 py-2 font-mono text-xs text-ink">
                {key}
              </code>
              <button
                onClick={() => copy(key, "key")}
                className="btn-secondary shrink-0 px-2.5"
                aria-label="Скопіювати ключ"
              >
                {copied === "key" ? <Check size={14} className="text-positive" /> : <Copy size={14} />}
              </button>
            </div>
          </div>

          <div>
            <span className="label">Приклад URL (GET — просто відкрити посилання)</span>
            <div className="flex gap-2">
              <code className="flex-1 truncate rounded-xl bg-canvas px-3 py-2 font-mono text-[0.6875rem] text-ink-soft">
                {quickUrl}
              </code>
              <button
                onClick={() => copy(quickUrl, "url")}
                className="btn-secondary shrink-0 px-2.5"
                aria-label="Скопіювати URL"
              >
                {copied === "url" ? <Check size={14} className="text-positive" /> : <Copy size={14} />}
              </button>
            </div>
          </div>

          <details className="rounded-xl bg-canvas p-3">
            <summary className="cursor-pointer text-xs font-medium text-ink">
              Як налаштувати «Команди» на iPhone
            </summary>
            <ol className="mt-3 space-y-2 text-[0.6875rem] leading-relaxed text-ink-soft">
              <li>
                <strong className="text-ink">1.</strong> Відкрийте «Команди» → «+» → «Додати дію» →
                знайдіть «Запитати про введення» (тип: Число, запит: «Сума?»).
              </li>
              <li>
                <strong className="text-ink">2.</strong> Додайте дію «Отримати вміст URL».
                URL: <code className="font-mono">{origin}/api/quick-entry</code>, метод POST.
              </li>
              <li>
                <strong className="text-ink">3.</strong> У «Заголовки» додайте{" "}
                <code className="font-mono">X-API-Key</code> зі значенням ключа вище.
              </li>
              <li>
                <strong className="text-ink">4.</strong> Тіло запиту — JSON з полями:{" "}
                <code className="font-mono">amount</code> (результат кроку 1),{" "}
                <code className="font-mono">note</code>, за бажанням{" "}
                <code className="font-mono">account</code>, <code className="font-mono">category</code>,{" "}
                <code className="font-mono">type</code>.
              </li>
              <li>
                <strong className="text-ink">5.</strong> Назвіть команду «Записати витрату» — і
                кажіть Siri цю фразу. Додайте команду на екран «Домівка» або в меню дій.
              </li>
            </ol>

            <p className="mt-3 text-[0.6875rem] text-ink-soft">
              Відповідь містить поле <code className="font-mono">message</code> — його зручно
              показати в нотифікації або дати озвучити Siri.
            </p>
          </details>

          <div className="rounded-xl border border-warning/25 bg-warning/[0.04] p-3">
            <p className="flex gap-2 text-[0.6875rem] leading-relaxed text-ink-soft">
              <AlertCircle size={13} className="mt-0.5 shrink-0 text-warning" />
              Ключ дає право створювати транзакції. Не публікуйте його. Якщо застосунок
              доступний з інтернету — тримайте його за HTTPS.
            </p>
          </div>

          <button onClick={revoke} className="btn-danger w-full" disabled={busy}>
            <Trash2 size={14} />
            Відкликати ключ
          </button>
        </div>
      )}
    </Card>
  );
}

/* ── Monobank ────────────────────────────────────────────────────────── */

function MonobankCard({
  settings,
  accounts,
  onSaved,
}: {
  settings: SettingsDTO;
  accounts: AccountDTO[];
  onSaved: () => Promise<void>;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [monoAccounts, setMonoAccounts] = useState<MonoAccountDTO[] | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [days, setDays] = useState(31);

  async function saveToken() {
    setBusy(true);
    setMessage(null);
    try {
      await post("/api/settings/monobank-token", { token });
      setToken("");
      await onSaved();
      setMessage({ text: "Токен збережено та зашифровано.", tone: "ok" });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Помилка", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function removeToken() {
    if (!confirm("Видалити токен Monobank?")) return;
    await del("/api/settings/monobank-token");
    setMonoAccounts(null);
    await onSaved();
  }

  async function loadMonoAccounts() {
    setBusy(true);
    setMessage(null);
    try {
      const data = await api<{ clientName: string; accounts: MonoAccountDTO[] }>(
        "/api/monobank/accounts",
      );
      setMonoAccounts(data.accounts);
      setClientName(data.clientName);
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Помилка", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function link(mono: MonoAccountDTO, localAccountId: string) {
    setBusy(true);
    try {
      if (localAccountId === "__none__") {
        const existing = mono.linkedTo?.id;
        if (existing) await del(`/api/monobank/link?localAccountId=${existing}`);
      } else {
        await post("/api/monobank/link", {
          monoAccountId: mono.id,
          localAccountId: localAccountId === "__new__" ? null : localAccountId,
          name: mono.title,
          currency: mono.currency,
          type: mono.type,
          maskedPan: mono.maskedPan,
          balance: mono.balance,
        });
      }
      await onSaved();
      await loadMonoAccounts();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Помилка", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await post<{ imported: number; skipped: number; balancesUpdated: number }>(
        "/api/monobank/sync",
        { days },
      );
      setMessage({
        text: `Готово: імпортовано ${res.imported}, пропущено дублів ${res.skipped}, оновлено балансів ${res.balancesUpdated}.`,
        tone: "ok",
      });
      await onSaved();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Помилка синхронізації", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const linkedCount = accounts.filter((a) => a.monoAccountId).length;

  return (
    <Card className="xl:col-span-2">
      <CardHeader
        title="Monobank"
        subtitle="Баланси, картки та виписка транзакцій"
        action={<Landmark size={16} className="text-ink-faint" />}
      />

      {!settings.hasMonobankToken ? (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-ink-soft">
            Отримайте персональний токен на{" "}
            <a
              href="https://api.monobank.ua/"
              target="_blank"
              rel="noreferrer"
              className="text-accent underline underline-offset-2"
            >
              api.monobank.ua
            </a>
            . Токен шифрується AES-256-GCM і використовується лише на сервері.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="field font-mono text-xs"
              placeholder="uXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <button onClick={saveToken} className="btn-primary shrink-0" disabled={busy || !token}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Key size={15} />}
              Зберегти токен
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-canvas p-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-ink">
                Токен активний
                {settings.monobankTokenHint && (
                  <span className="ml-1.5 font-mono text-ink-faint">···{settings.monobankTokenHint}</span>
                )}
              </p>
              <p className="mt-0.5 text-[0.6875rem] text-ink-faint">
                {settings.lastSyncAt ? (
                  <>
                    Остання синхронізація:{" "}
                    {new Date(settings.lastSyncAt).toLocaleString("uk-UA", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {settings.lastSyncStatus === "ERROR" && (
                      <span className="text-negative"> — з помилкою</span>
                    )}
                  </>
                ) : (
                  "Ще не синхронізовано"
                )}
                {" · "}
                {linkedCount} прив’язаних рахунків
              </p>
            </div>

            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="rounded-xl border border-line bg-surface px-2.5 py-2 text-xs"
              aria-label="Період виписки"
            >
              <option value={7}>7 днів</option>
              <option value={14}>14 днів</option>
              <option value={31}>31 день</option>
            </select>

            <button onClick={sync} className="btn-primary shrink-0" disabled={busy || linkedCount === 0}>
              {busy ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <RefreshCw size={15} />
              )}
              Синхронізувати зараз
            </button>

            <button onClick={removeToken} className="btn-ghost shrink-0 p-2" aria-label="Видалити токен">
              <Trash2 size={15} />
            </button>
          </div>

          {settings.lastSyncStatus === "ERROR" && settings.lastSyncError && (
            <p className="rounded-xl bg-negative/5 px-3 py-2 text-xs text-negative">
              {settings.lastSyncError}
            </p>
          )}

          <div>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium text-ink">
                Рахунки Monobank {clientName && <span className="text-ink-faint">· {clientName}</span>}
              </p>
              <button onClick={loadMonoAccounts} className="btn-secondary text-xs" disabled={busy}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                Завантажити список
              </button>
            </div>

            {monoAccounts === null ? (
              <p className="rounded-xl bg-canvas px-3 py-6 text-center text-xs text-ink-faint">
                Натисніть «Завантажити список», щоб побачити рахунки та прив’язати їх.
                <br />
                Monobank дозволяє один запит на 60 секунд.
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {monoAccounts.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-ink">{m.title}</p>
                      <p className="tabular text-[0.6875rem] text-ink-faint">
                        {formatMoney(m.balance, m.currency)}
                        {m.maskedPan ? ` · ${m.maskedPan}` : ""}
                      </p>
                    </div>

                    {m.linkedTo ? (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-accent-soft px-2 py-1 text-[0.6875rem] text-accent">
                        <Link2 size={11} />
                        {m.linkedTo.name}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[0.6875rem] text-ink-faint">
                        <Link2Off size={11} />
                        не прив’язано
                      </span>
                    )}

                    <select
                      value={m.linkedTo?.id ?? ""}
                      onChange={(e) => link(m, e.target.value)}
                      className="rounded-lg border border-line px-2 py-1.5 text-[0.6875rem]"
                      aria-label={`Прив'язати ${m.title}`}
                      disabled={busy}
                    >
                      <option value="" disabled>
                        Прив’язати до…
                      </option>
                      <option value="__new__">+ Створити новий рахунок</option>
                      {accounts
                        .filter((a) => !a.isArchived)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({a.currency})
                          </option>
                        ))}
                      {m.linkedTo && <option value="__none__">— Відв’язати —</option>}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-[0.6875rem] leading-relaxed text-ink-faint">
            Під час синхронізації баланси беруться з банку як джерело істини, а транзакції
            дедуплікуються за ідентифікатором операції. Категорія присвоюється автоматично
            за MCC-кодом або ключовим словом в описі.
          </p>
        </div>
      )}

      {message && (
        <p
          className={`mt-4 rounded-xl px-3 py-2 text-xs ${
            message.tone === "ok" ? "bg-positive/5 text-positive" : "bg-negative/5 text-negative"
          }`}
        >
          {message.text}
        </p>
      )}
    </Card>
  );
}
