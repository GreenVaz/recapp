import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClient, signUp, startTestApi, stopTestApi } from './api-harness.js';
import type { PGliteDatabase } from './pglite.js';
import type { Account } from '@core/types.js';

/**
 * Інтеграційні тести підключення банку.
 *
 * Мокається рівно одне — мережа до api.monobank.ua. Роутер, база, RLS і
 * міграції справжні, тож перевіряється саме та поведінка, що поїде в прод.
 */

let db: PGliteDatabase;

beforeAll(async () => {
  db = await startTestApi();
});
afterAll(async () => {
  await stopTestApi();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const CLIENT_INFO = {
  clientId: 'client-1',
  name: 'Ігор',
  accounts: [
    {
      id: 'acc-uah',
      balance: 100_000, // 1000.00
      creditLimit: 0,
      type: 'black',
      currencyCode: 980,
      maskedPan: ['444111******9198'],
    },
  ],
  jars: [
    { id: 'jar-1', title: 'На кварту', currencyCode: 980, balance: 2_500, goal: 1_000_000 },
  ],
};

const STATEMENT = [
  {
    id: 'tx-1',
    time: Math.floor(Date.parse('2026-10-15T09:00:00Z') / 1000),
    description: 'Сільпо',
    mcc: 5411,
    hold: false,
    amount: -25_000,
    operationAmount: -25_000,
    currencyCode: 980,
  },
  {
    id: 'tx-2',
    time: Math.floor(Date.parse('2026-10-16T09:00:00Z') / 1000),
    description: 'Зарплата',
    mcc: 4829,
    hold: false,
    amount: 5_000,
    operationAmount: 5_000,
    currencyCode: 980,
  },
];

/** Підміняє мережу: client-info завжди, виписку — лише на першому вікні. */
function stubBank(options: { statementFor?: string; onWebhook?: (url: string) => void } = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);

      if (url.endsWith('/personal/client-info')) {
        return new Response(JSON.stringify(CLIENT_INFO), { status: 200 });
      }
      if (url.includes('/personal/webhook')) {
        options.onWebhook?.(JSON.parse(String(init?.body ?? '{}')).webHookUrl ?? '');
        return new Response('{}', { status: 200 });
      }
      if (url.includes('/personal/statement/')) {
        const account = url.split('/personal/statement/')[1]!.split('/')[0]!;
        const wanted = options.statementFor ?? 'acc-uah';
        return new Response(JSON.stringify(account === wanted ? STATEMENT : []), { status: 200 });
      }
      return new Response('{"errorDescription":"не передбачено в тесті"}', { status: 404 });
    }),
  );
  return calls;
}

/** Довантаження обмежене одним запитом на хвилину — у тестах чекати нічого. */
async function clearRateLimit(userId: string) {
  await db.tx((c) =>
    c.query(`update bank_connections set last_sync_at = null where user_id = $1`, [userId]),
  );
}

async function accounts(client: ReturnType<typeof createClient>) {
  return client.get<Account[]>('/api/accounts');
}

describe('підключення банку', () => {
  it('створює рахунки, банки й план довантаження', async () => {
    const webhooks: string[] = [];
    stubBank({ onWebhook: (u) => webhooks.push(u) });

    const { client } = await signUp();
    const result = await client.post<{
      accounts: number; windows: number; webhookState: string; clientName: string;
    }>('/api/monobank/connect', { token: 'x'.repeat(30), months: 2 });

    expect(result.clientName).toBe('Ігор');
    expect(result.accounts).toBe(2); // картка + банка
    expect(result.windows).toBeGreaterThan(0);
    expect(result.webhookState).toBe('active');
    expect(webhooks[0]).toMatch(/\/api\/monobank\/webhook\/.+/);

    const list = await accounts(client);
    const card = list.find((a) => a.name.includes('9198'));
    const jar = list.find((a) => a.name.includes('На кварту'));
    expect(card).toBeTruthy();
    expect(jar).toBeTruthy();
    // Поки операцій немає, баланс дорівнює тому, що сказав банк.
    expect(card!.balance).toBe(100_000);
    expect(jar!.balance).toBe(2_500);
  });

  it('хибний токен не лишає сліду в базі', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"errorDescription":"Unknown token"}', { status: 403 })),
    );

    const { client } = await signUp();
    await expect(
      client.post('/api/monobank/connect', { token: 'y'.repeat(30) }),
    ).rejects.toThrow(/Unknown token/);

    const status = await client.get<{ connected: boolean }>('/api/monobank');
    expect(status.connected).toBe(false);
  });
});

describe('довантаження історії', () => {
  it('переносить операції і лишає баланс рівним банківському', async () => {
    stubBank();
    const { client, user } = await signUp();
    await client.post('/api/monobank/connect', { token: 'x'.repeat(30), months: 1 });

    await clearRateLimit(user.id);
    const first = await client.post<{
      status: string; inserted: number; fetched: number; pending: number;
    }>('/api/monobank/sync');

    expect(first.fetched).toBe(2);
    expect(first.inserted).toBe(2);

    const card = (await accounts(client)).find((a) => a.name.includes('9198'))!;
    // Операції на −250.00 і +50.00 додані, але баланс мусить лишитися тим,
    // що віддав банк: історія вже була в ньому врахована.
    expect(card.balance).toBe(100_000);
  });

  it('повторне довантаження того самого вікна нічого не дублює', async () => {
    stubBank();
    const { client, user } = await signUp();
    await client.post('/api/monobank/connect', { token: 'x'.repeat(30), months: 1 });

    // Лишаємо вікна лише для картки: у банки виписка порожня, і без цього
    // другий прогін міг би взяти інше вікно, а тест перевіряє саме повтор.
    await db.tx((c) =>
      c.query(
        `delete from sync_windows w
          using accounts a
          where w.account_id = a.id and w.user_id = $1 and a.external_id <> 'mono:acc-uah'`,
        [user.id],
      ),
    );

    await clearRateLimit(user.id);
    await client.post('/api/monobank/sync');

    // Повертаємо вікно в чергу й проганяємо ще раз — так виглядає повтор
    // після обриву звʼязку.
    await db.tx((c) =>
      c.query(`update sync_windows set status = 'pending' where user_id = $1`, [user.id]),
    );
    await clearRateLimit(user.id);
    const again = await client.post<{ inserted: number; fetched: number }>('/api/monobank/sync');

    expect(again.fetched).toBe(2);
    expect(again.inserted).toBe(0); // зовнішній id не дав вставити вдруге

    const card = (await accounts(client)).find((a) => a.name.includes('9198'))!;
    expect(card.balance).toBe(100_000); // і баланс не зрушив
  });

  it('другий виклик поспіль наражається на ліміт банку, а не на помилку', async () => {
    stubBank();
    const { client, user } = await signUp();
    await client.post('/api/monobank/connect', { token: 'x'.repeat(30), months: 1 });

    await clearRateLimit(user.id);
    await client.post('/api/monobank/sync');

    const response = await client.request('POST', '/api/monobank/sync', {});
    expect(response.status).toBe(202);
    const body = (await response.json()) as { status: string; retryAfterSeconds: number };
    expect(body.status).toBe('waiting');
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('вебхук', () => {
  async function connectAndGetSecret() {
    let secret = '';
    stubBank({ onWebhook: (url) => { secret = url.split('/').pop() ?? ''; } });
    const { client, user } = await signUp();
    await client.post('/api/monobank/connect', { token: 'x'.repeat(30), months: 1 });
    return { client, user, secret };
  }

  it('нова операція зʼявляється і зсуває баланс', async () => {
    const { client, secret } = await connectAndGetSecret();
    const before = (await accounts(client)).find((a) => a.name.includes('9198'))!;

    const anonymous = createClient();
    const response = await anonymous.request('POST', `/api/monobank/webhook/${secret}`, {
      type: 'StatementItem',
      data: {
        account: 'acc-uah',
        statementItem: {
          id: 'live-1',
          time: Math.floor(Date.now() / 1000),
          description: 'Кава',
          mcc: 5814,
          hold: false,
          amount: -7_500,
          operationAmount: -7_500,
          currencyCode: 980,
        },
      },
    });
    expect(response.status).toBe(200);

    const after = (await accounts(client)).find((a) => a.name.includes('9198'))!;
    // Операція щойно сталася — баланс мусить зменшитись рівно на неї.
    expect(after.balance).toBe(before.balance - 7_500);
  });

  it('уточнення незавершеної операції оновлює суму, а не додає другу', async () => {
    const { client, secret } = await connectAndGetSecret();
    const anonymous = createClient();
    const send = (amount: number, hold: boolean) =>
      anonymous.request('POST', `/api/monobank/webhook/${secret}`, {
        type: 'StatementItem',
        data: {
          account: 'acc-uah',
          statementItem: {
            id: 'hold-1', time: Math.floor(Date.now() / 1000), description: 'Готель',
            mcc: 7011, hold, amount, operationAmount: amount, currencyCode: 980,
          },
        },
      });

    await send(-100_00, true);
    const held = (await accounts(client)).find((a) => a.name.includes('9198'))!;
    await send(-120_00, false); // банк уточнив суму під тим самим id
    const settled = (await accounts(client)).find((a) => a.name.includes('9198'))!;

    expect(settled.balance).toBe(held.balance - 20_00);

    const list = await client.get<{ total: number }>('/api/transactions');
    expect(list.total).toBe(1);
  });

  it('невідомий секрет не створює нічого і не змушує банк ретраїти', async () => {
    const { client } = await connectAndGetSecret();
    const anonymous = createClient();
    const response = await anonymous.request('POST', '/api/monobank/webhook/not-a-real-secret', {
      type: 'StatementItem',
      data: {
        account: 'acc-uah',
        statementItem: {
          id: 'ghost', time: Math.floor(Date.now() / 1000), description: 'Привид',
          mcc: 0, hold: false, amount: -999_00, operationAmount: -999_00, currencyCode: 980,
        },
      },
    });

    expect(response.status).toBe(200);
    const list = await client.get<{ total: number }>('/api/transactions');
    expect(list.total).toBe(0);
  });
});

describe('ізоляція між користувачами', () => {
  it('чужий не бачить ні підключення, ні рахунків банку', async () => {
    stubBank();
    const { client } = await signUp();
    await client.post('/api/monobank/connect', { token: 'x'.repeat(30), months: 1 });

    const stranger = await signUp();
    const status = await stranger.client.get<{ connected: boolean }>('/api/monobank');
    expect(status.connected).toBe(false);

    const theirAccounts = await accounts(stranger.client);
    expect(theirAccounts.every((a) => !a.name.includes('9198'))).toBe(true);
  });

  it('відключення прибирає токен, але лишає операції користувачеві', async () => {
    stubBank();
    const { client, user } = await signUp();
    await client.post('/api/monobank/connect', { token: 'x'.repeat(30), months: 1 });
    await clearRateLimit(user.id);
    await client.post('/api/monobank/sync');

    const before = await client.get<{ total: number }>('/api/transactions');
    expect(before.total).toBeGreaterThan(0);

    expect((await client.del('/api/monobank')).status).toBe(204);

    const status = await client.get<{ connected: boolean }>('/api/monobank');
    expect(status.connected).toBe(false);

    const after = await client.get<{ total: number }>('/api/transactions');
    expect(after.total).toBe(before.total); // дані нікуди не зникли
  });
});
