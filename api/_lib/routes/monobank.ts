/**
 * Підключення Monobank: разове довантаження історії та живі оновлення.
 *
 * Чому саме так:
 *
 * - **Історія тягнеться по одному вікну за HTTP-виклик.** Банк дозволяє
 *   один запит на 60 секунд, а безкоштовний тариф Vercel не дає фонових
 *   задач. Тому прогрес лежить у `sync_windows`, і процес можна перервати
 *   й продовжити — застосунок просто бере наступне незакрите вікно.
 *
 * - **Живі оновлення — вебхуком, не опитуванням.** Банк сам шле нову
 *   операцію. Це єдиний спосіб мати миттєвість без планувальника.
 *
 * - **Баланс лишається похідною.** Банк віддає готове число, а в нас
 *   баланс рахується з історії. Інваріант тримається так: щойно
 *   довантаження додає операції на суму D, `initial_balance` зменшується
 *   на D. Для операції з вебхука поправка НЕ потрібна — вона щойно
 *   сталася, і баланс банку теж на неї зрушив.
 */

import {
  accountTitle,
  dayEndUnix,
  dayStartUnix,
  jarTitle,
  planWindows,
  signedAmount,
  toTransactionDraft,
  currencyFromCode,
  ratesFromMono,
  RATE_LIMIT_MS,
  RATES_TTL_MS,
  type MonoClientInfo,
} from '../../../src/core/monobank.js';
import { addDays, today as todayISO } from '../../../src/core/dates.js';
import { toNumeric } from '../../../src/core/money.js';
import { asSystem, asUser, type Conn } from '../db/types.js';
import { toDateISO } from '../mappers.js';
import { badRequest, conflict, json, noContent, notFound, readJson } from '../http.js';
import { guarded, open, pathParam } from '../router.js';
import { monobankConnectSchema, monobankWebhookSchema } from '../schemas.js';
import { decryptSecret, encryptSecret, generateWebhookSecret } from '../secrets.js';
import {
  clearWebhook,
  fetchClientInfo,
  fetchCurrencyRates,
  fetchStatement,
  MonobankError,
  setWebhook,
} from '../monobank-client.js';

const PROVIDER = 'monobank';

interface ConnectionRow {
  user_id: string;
  token_cipher: string;
  client_id: string | null;
  client_name: string | null;
  webhook_secret: string;
  webhook_state: string;
  connected_at: string;
  last_sync_at: string | Date | null;
  last_error: string | null;
}

async function loadConnection(c: Conn, userId: string): Promise<ConnectionRow | null> {
  const found = await c.query<ConnectionRow>(
    `select * from bank_connections where user_id = $1 and provider = $2`,
    [userId, PROVIDER],
  );
  return found.rows[0] ?? null;
}

/** Публічна адреса застосунку — саме її банк викликатиме. */
function publicOrigin(url: URL): string {
  const configured = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '');
  return configured || url.origin;
}

// ─── Стан ──────────────────────────────────────────────────────────────────

guarded('GET', '/api/monobank', async ({ db, userId }) => {
  return json(
    await asUser(db, userId, async (c) => {
      const connection = await loadConnection(c, userId);
      if (!connection) return { connected: false };

      const progress = await c.query<{ status: string; n: string }>(
        `select status, count(*)::text as n from sync_windows where user_id = $1 group by status`,
        [userId],
      );
      const counts = Object.fromEntries(progress.rows.map((r) => [r.status, Number(r.n)]));
      const pending = counts.pending ?? 0;

      const linked = await c.query<{ n: string }>(
        `select count(*)::text as n from accounts
          where user_id = $1 and external_id is not null`,
        [userId],
      );

      return {
        connected: true,
        clientName: connection.client_name,
        webhookState: connection.webhook_state,
        connectedAt: connection.connected_at,
        lastSyncAt: connection.last_sync_at,
        lastError: connection.last_error,
        accounts: Number(linked.rows[0]?.n ?? 0),
        windows: {
          pending,
          done: counts.done ?? 0,
          failed: counts.failed ?? 0,
        },
        /** Банк дозволяє запит на хвилину, тож це і є чесна оцінка часу. */
        minutesLeft: pending,
      };
    }),
  );
});

// ─── Підключення ───────────────────────────────────────────────────────────

guarded('POST', '/api/monobank/connect', async ({ db, userId, request, url }) => {
  const body = monobankConnectSchema.parse(await readJson(request));

  // Токен перевіряємо до запису: якщо він хибний, у базі не має лишитися
  // ні рядка, і користувач має побачити помилку банку, а не нашу.
  let info: MonoClientInfo;
  try {
    info = await fetchClientInfo(body.token);
  } catch (e) {
    if (e instanceof MonobankError && e.isRateLimited) {
      throw conflict('Банк дозволяє один запит на хвилину. Спробуйте за хвилину.');
    }
    throw badRequest(e instanceof Error ? e.message : 'Банк не прийняв токен');
  }

  const secret = generateWebhookSecret();
  const cipher = await encryptSecret(body.token);
  const start = addDays(todayISO(), -Math.round(body.months * 30.44));
  const end = todayISO();

  const result = await asUser(db, userId, async (c) => {
    await c.query(
      `insert into bank_connections
         (user_id, provider, token_cipher, client_id, client_name, webhook_secret)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (user_id, provider) do update
         set token_cipher = excluded.token_cipher,
             client_id    = excluded.client_id,
             client_name  = excluded.client_name,
             connected_at = now(),
             last_error   = null`,
      [userId, PROVIDER, cipher, info.clientId, info.name, secret],
    );

    const linked: Array<{ id: string; externalId: string }> = [];

    const upsert = async (
      externalId: string,
      name: string,
      type: string,
      currency: string,
      balance: number,
      sortOrder: number,
    ) => {
      const row = await c.query<{ id: string }>(
        `insert into accounts (user_id, name, type, currency, initial_balance, external_id, sort_order)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (user_id, external_id) where external_id is not null
         do update set name = excluded.name, currency = excluded.currency
         returning id`,
        [userId, name, type, currency, toNumeric(balance), externalId, sortOrder],
      );
      linked.push({ id: row.rows[0]!.id, externalId });
    };

    let order = 100;
    for (const account of info.accounts) {
      const currency = currencyFromCode(account.currencyCode);
      if (!currency) continue; // Валюту, якої ми не підтримуємо, не вигадуємо.
      await upsert(`mono:${account.id}`, accountTitle(account), 'card', currency, account.balance, order++);
    }
    for (const jar of info.jars ?? []) {
      const currency = currencyFromCode(jar.currencyCode);
      if (!currency) continue;
      await upsert(`mono:${jar.id}`, jarTitle(jar), 'savings', currency, jar.balance, order++);
    }

    // Вікна довантаження: для кожного рахунку свій набір.
    const windows = planWindows(start, end);
    for (const account of linked) {
      for (const w of windows) {
        await c.query(
          `insert into sync_windows (user_id, account_id, from_date, to_date)
           values ($1,$2,$3,$4)
           on conflict (account_id, from_date, to_date) do nothing`,
          [userId, account.id, w.from, w.to],
        );
      }
    }

    return { accounts: linked.length, windows: linked.length * windows.length };
  });

  // Вебхук реєструємо після того, як маршрут уже є і секрет записаний:
  // банк одразу стукає GET і чекає 200.
  let webhookState = 'active';
  let webhookError: string | null = null;
  try {
    await setWebhook(body.token, `${publicOrigin(url)}/api/monobank/webhook/${secret}`);
  } catch (e) {
    // Невдалий вебхук не ламає підключення: історію все одно видно,
    // просто нові операції доведеться підтягувати вручну.
    webhookState = 'failed';
    webhookError = e instanceof Error ? e.message : 'Не вдалося зареєструвати вебхук';
  }

  await asUser(db, userId, (c) =>
    c.query(`update bank_connections set webhook_state = $3, last_error = $4
              where user_id = $1 and provider = $2`,
      [userId, PROVIDER, webhookState, webhookError]),
  );

  // Курси тягнемо одразу: без них валютні рахунки не потраплять у підсумки,
  // а користувач про це дізнався б не одразу. Окремий endpoint з власним
  // лімітом, тож на client-info це не впливає. Невдача не критична.
  let ratesUpdated = 0;
  try {
    const rows = ratesFromMono(await fetchCurrencyRates());
    await asUser(db, userId, async (c) => {
      for (const row of rows) {
        await c.query(
          `insert into exchange_rates (user_id, base, quote, rate)
           values ($1,$2,$3,$4)
           on conflict (user_id, base, quote)
           do update set rate = excluded.rate, updated_at = now()`,
          [userId, row.base, row.quote, row.rate],
        );
      }
    });
    ratesUpdated = rows.length;
  } catch {
    ratesUpdated = 0;
  }

  return json({
    connected: true,
    clientName: info.name,
    ratesUpdated,
    accounts: result.accounts,
    windows: result.windows,
    minutesLeft: result.windows,
    webhookState,
    webhookError,
  });
});

// ─── Відключення ───────────────────────────────────────────────────────────

guarded('DELETE', '/api/monobank', async ({ db, userId }) => {
  const token = await asUser(db, userId, async (c) => {
    const connection = await loadConnection(c, userId);
    if (!connection) return null;
    await c.query(`delete from sync_windows where user_id = $1`, [userId]);
    await c.query(`delete from bank_connections where user_id = $1 and provider = $2`, [
      userId,
      PROVIDER,
    ]);
    return connection.token_cipher;
  });

  if (!token) throw notFound('Банк не підключено');

  // Рахунки й операції лишаються: це дані користувача, а не банку.
  try {
    await clearWebhook(await decryptSecret(token));
  } catch {
    // Банк міг і не відповісти — підключення в нас уже видалене,
    // більше нічого корисного зробити не можна.
  }
  return noContent();
});

// ─── Довантаження: одне вікно за виклик ────────────────────────────────────

guarded('POST', '/api/monobank/sync', async ({ db, userId }) => {
  const prepared = await asUser(db, userId, async (c) => {
    const connection = await loadConnection(c, userId);
    if (!connection) throw notFound('Банк не підключено');

    if (connection.last_sync_at) {
      const since = connection.last_sync_at;
      const at = since instanceof Date ? since.getTime() : Date.parse(String(since));
      const waited = Number.isFinite(at) ? Date.now() - at : Number.POSITIVE_INFINITY;
      if (waited < RATE_LIMIT_MS) {
        return { wait: Math.ceil((RATE_LIMIT_MS - waited) / 1000) } as const;
      }
    }

    const next = await c.query<{
      id: string; account_id: string; from_date: string; to_date: string;
      external_id: string; currency: string;
    }>(
      `select w.id, w.account_id, w.from_date, w.to_date, a.external_id, a.currency
         from sync_windows w
         join accounts a on a.id = w.account_id
        where w.user_id = $1 and w.status = 'pending'
        order by w.from_date desc
        limit 1`,
      [userId],
    );

    const window = next.rows[0];
    if (!window) return { done: true } as const;

    await c.query(
      `update sync_windows set attempts = attempts + 1, attempted_at = now() where id = $1`,
      [window.id],
    );
    await c.query(
      `update bank_connections set last_sync_at = now() where user_id = $1 and provider = $2`,
      [userId, PROVIDER],
    );

    return { window, token: connection.token_cipher } as const;
  });

  if ('wait' in prepared) {
    return json({ status: 'waiting', retryAfterSeconds: prepared.wait }, { status: 202 });
  }
  if ('done' in prepared) {
    return json({ status: 'done', pending: 0, minutesLeft: 0 });
  }

  const { window } = prepared;
  const token = await decryptSecret(prepared.token);
  const monoAccountId = window.external_id.replace(/^mono:/, '');

  let items;
  try {
    items = await fetchStatement(
      token,
      monoAccountId,
      dayStartUnix(toDateISO(window.from_date)),
      dayEndUnix(toDateISO(window.to_date)),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Банк не віддав виписку';
    const rateLimited = e instanceof MonobankError && e.isRateLimited;
    await asUser(db, userId, (c) =>
      c.query(
        // Ліміт запитів — не помилка вікна: лишаємо його в черзі.
        `update sync_windows set status = $2, last_error = $3 where id = $1`,
        [window.id, rateLimited ? 'pending' : 'failed', message],
      ),
    );
    if (rateLimited) {
      return json({ status: 'waiting', retryAfterSeconds: 60 }, { status: 202 });
    }
    throw badRequest(message);
  }

  const drafts = items.map((item) => toTransactionDraft(item, window.currency));

  const summary = await asUser(db, userId, async (c) => {
    let inserted = 0;
    let delta = 0;

    for (const draft of drafts) {
      const row = await c.query<{ id: string }>(
        `insert into transactions
           (user_id, account_id, kind, amount, currency, occurred_on, status, note, external_id)
         values ($1,$2,$3,$4,$5,$6,'posted',$7,$8)
         on conflict (user_id, external_id) where external_id is not null
         do nothing
         returning id`,
        [
          userId, window.account_id, draft.kind, toNumeric(draft.amount),
          draft.currency, draft.occurredOn, draft.note, draft.externalId,
        ],
      );
      if (row.rows.length > 0) {
        inserted += 1;
        delta += signedAmount(draft);
      }
    }

    // Баланс банку вже враховує ці операції, а наш рахується з історії:
    // тримаємо рівність, зміщуючи початковий залишок на ту саму суму.
    if (delta !== 0) {
      await c.query(
        `update accounts set initial_balance = initial_balance - $2::numeric where id = $1`,
        [window.account_id, toNumeric(delta)],
      );
    }

    await c.query(
      `update sync_windows
          set status = 'done', fetched = $2, inserted = $3, completed_at = now(), last_error = null
        where id = $1`,
      [window.id, drafts.length, inserted],
    );

    const left = await c.query<{ n: string }>(
      `select count(*)::text as n from sync_windows where user_id = $1 and status = 'pending'`,
      [userId],
    );
    return { inserted, fetched: drafts.length, pending: Number(left.rows[0]?.n ?? 0) };
  });

  return json({
    status: summary.pending > 0 ? 'more' : 'done',
    window: { from: toDateISO(window.from_date), to: toDateISO(window.to_date) },
    ...summary,
    minutesLeft: summary.pending,
    retryAfterSeconds: summary.pending > 0 ? 60 : 0,
  });
});

// ─── Вебхук ────────────────────────────────────────────────────────────────

/** Банк перевіряє адресу звичайним GET і чекає 200. */
open('GET', '/api/monobank/webhook/:secret', async () => new Response('ok', { status: 200 }));

open('POST', '/api/monobank/webhook/:secret', async ({ db, params, request }) => {
  const secret = pathParam(params, 'secret');

  // Сесії тут немає — власника знаходимо за секретом у шляху, під роллю
  // власника БД. Далі вся робота вже йде від імені користувача.
  const owner = await asSystem(db, async (c) => {
    const found = await c.query<{ user_id: string }>(
      `select user_id from bank_connections where webhook_secret = $1 and provider = $2`,
      [secret, PROVIDER],
    );
    return found.rows[0]?.user_id ?? null;
  });

  // Невідомий секрет: відповідаємо 200, щоб банк не ретраїв вічно,
  // але нічого не робимо.
  if (!owner) return new Response('ok', { status: 200 });

  const parsed = monobankWebhookSchema.safeParse(await readJson(request));
  if (!parsed.success) return new Response('ok', { status: 200 });

  const { account, statementItem } = parsed.data.data;

  await asUser(db, owner, async (c) => {
    const target = await c.query<{ id: string; currency: string }>(
      `select id, currency from accounts where user_id = $1 and external_id = $2`,
      [owner, `mono:${account}`],
    );
    const row = target.rows[0];
    if (!row) return;

    const draft = toTransactionDraft(
      { ...statementItem, originalMcc: statementItem.mcc },
      row.currency,
    );

    // Операція щойно сталася, тож баланс банку вже її враховує — і наш
    // похідний баланс зрушить на ту саму суму. Поправка не потрібна.
    // `do update` потрібен, бо незавершена операція (hold) потім
    // приходить ще раз із уточненою сумою під тим самим id.
    await c.query(
      `insert into transactions
         (user_id, account_id, kind, amount, currency, occurred_on, status, note, external_id)
       values ($1,$2,$3,$4,$5,$6,'posted',$7,$8)
       on conflict (user_id, external_id) where external_id is not null
       do update set amount      = excluded.amount,
                     kind        = excluded.kind,
                     occurred_on = excluded.occurred_on,
                     note        = excluded.note,
                     updated_at  = now()`,
      [
        owner, row.id, draft.kind, toNumeric(draft.amount),
        draft.currency, draft.occurredOn, draft.note, draft.externalId,
      ],
    );

    await c.query(
      `update bank_connections set webhook_state = 'active', last_sync_at = last_sync_at
        where user_id = $1 and provider = $2`,
      [owner, PROVIDER],
    );
  });

  return new Response('ok', { status: 200 });
});

// ─── Курси валют ───────────────────────────────────────────────────────────

/**
 * Підтягує курси з публічного endpoint банку.
 *
 * Токен не потрібен, тож маршрут працює і без підключеного банку —
 * курси корисні самі по собі.
 *
 * Банк оновлює їх раз на 5 хвилин і на частіші запити відповідає 429,
 * тому спершу дивимось, коли оновлювали востаннє. `force` обходить цю
 * перевірку лише для явного натискання кнопки.
 */
guarded('POST', '/api/monobank/rates', async ({ db, userId, url }) => {
  const force = url.searchParams.get('force') === '1';

  const fresh = await asUser(db, userId, async (c) => {
    const last = await c.query<{ updated_at: string | Date }>(
      `select max(updated_at) as updated_at from exchange_rates where user_id = $1`,
      [userId],
    );
    const raw = last.rows[0]?.updated_at;
    if (!raw) return false;
    const at = raw instanceof Date ? raw.getTime() : Date.parse(String(raw));
    return Number.isFinite(at) && Date.now() - at < RATES_TTL_MS;
  });

  if (fresh && !force) {
    return json({ status: 'fresh', rates: await readRates(db, userId) });
  }

  let rows;
  try {
    rows = ratesFromMono(await fetchCurrencyRates());
  } catch (e) {
    throw badRequest(e instanceof Error ? e.message : 'Банк не віддав курси');
  }

  if (rows.length === 0) throw badRequest('Банк не повернув потрібних курсів');

  await asUser(db, userId, async (c) => {
    for (const row of rows) {
      await c.query(
        `insert into exchange_rates (user_id, base, quote, rate)
         values ($1,$2,$3,$4)
         on conflict (user_id, base, quote)
         do update set rate = excluded.rate, updated_at = now()`,
        [userId, row.base, row.quote, row.rate],
      );
    }
  });

  return json({ status: 'updated', rates: await readRates(db, userId) });
});

async function readRates(db: Parameters<typeof asUser>[0], userId: string) {
  return asUser(db, userId, async (c) => {
    const found = await c.query<{ base: string; quote: string; rate: string }>(
      `select base, quote, rate from exchange_rates where user_id = $1 order by base`,
      [userId],
    );
    return found.rows.map((r) => ({ base: r.base, quote: r.quote, rate: Number(r.rate) }));
  });
}
