import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, signUp, startTestApi, stopTestApi, type ApiClient } from './api-harness.ts';
import type { Account, Category, Transaction } from '@core/types.ts';

const uah = (major: number) => Math.round(major * 100);

beforeAll(async () => {
  await startTestApi();
});
afterAll(async () => {
  await stopTestApi();
});

async function firstAccount(client: ApiClient): Promise<Account> {
  const accounts = await client.get<Account[]>('/api/accounts');
  return accounts[0]!;
}

describe('реєстрація та сесія', () => {
  it('створює робочий простір із категоріями та рахунком', async () => {
    const { client, user } = await signUp();
    expect(user.id).toBeTruthy();

    const me = await client.get<{ email: string }>('/api/auth/me');
    expect(me.email).toBe(user.email);

    const accounts = await client.get<Account[]>('/api/accounts');
    expect(accounts).toHaveLength(1);

    const categories = await client.get<Category[]>('/api/categories');
    expect(categories.length).toBeGreaterThan(20);
    expect(categories.some((c) => c.name === 'Продукти' && c.parentId === null)).toBe(true);
    expect(categories.some((c) => c.name === 'Супермаркети' && c.parentId !== null)).toBe(true);
  });

  it('не пускає без сесії', async () => {
    const anonymous = createClient();
    const response = await anonymous.request('GET', '/api/accounts');
    expect(response.status).toBe(401);
  });

  it('відхиляє другу реєстрацію на ту саму пошту', async () => {
    const email = `dup${Date.now()}@test.local`;
    await signUp(email);
    const second = createClient();
    const response = await second.request('POST', '/api/auth/register', {
      email,
      password: 'correct-horse-battery',
    });
    expect(response.status).toBe(400);
  });

  it('логін із невірним паролем не видає сесію', async () => {
    const email = `login${Date.now()}@test.local`;
    await signUp(email);

    const fresh = createClient();
    const bad = await fresh.request('POST', '/api/auth/login', { email, password: 'wrong-password' });
    expect(bad.status).toBe(401);
    expect(fresh.cookie).toBeNull();

    const good = await fresh.request('POST', '/api/auth/login', {
      email,
      password: 'correct-horse-battery',
    });
    expect(good.status).toBe(200);
    expect(fresh.cookie).toBeTruthy();
  });

  it('зміна пароля анулює старі сесії', async () => {
    const email = `pwd${Date.now()}@test.local`;
    const { client } = await signUp(email);

    const otherDevice = createClient();
    await otherDevice.post('/api/auth/login', { email, password: 'correct-horse-battery' });
    expect((await otherDevice.request('GET', '/api/auth/me')).status).toBe(200);

    await client.post('/api/auth/password', {
      currentPassword: 'correct-horse-battery',
      newPassword: 'brand-new-password',
    });

    // Старий токен більше не дійсний, а поточний пристрій лишився в сесії.
    expect((await otherDevice.request('GET', '/api/auth/me')).status).toBe(401);
    expect((await client.request('GET', '/api/auth/me')).status).toBe(200);
  });
});

describe('ізоляція користувачів', () => {
  it('чужий рахунок не видно і не можна змінити', async () => {
    const alice = await signUp();
    const bob = await signUp();

    const aliceAccount = await firstAccount(alice.client);
    const bobAccounts = await bob.client.get<Account[]>('/api/accounts');
    expect(bobAccounts.some((a) => a.id === aliceAccount.id)).toBe(false);

    const patch = await bob.client.request('PATCH', `/api/accounts/${aliceAccount.id}`, {
      name: 'Викрадено',
    });
    expect(patch.status).toBe(404);

    const unchanged = await firstAccount(alice.client);
    expect(unchanged.name).not.toBe('Викрадено');
  });
});

describe('рахунки та баланси', () => {
  it('баланс випливає з початкового залишку й операцій', async () => {
    const { client } = await signUp();
    const account = await client.post<Account>('/api/accounts', {
      name: 'Основна',
      type: 'bank',
      currency: 'UAH',
      initialBalance: uah(20_000),
    });
    expect(account.balance).toBe(uah(20_000));

    await client.post('/api/transactions', {
      kind: 'income', accountId: account.id, amount: uah(40_000), occurredOn: '2026-11-10',
    });
    await client.post('/api/transactions', {
      kind: 'expense', accountId: account.id, amount: uah(15_000), occurredOn: '2026-11-05',
    });

    const accounts = await client.get<Account[]>('/api/accounts');
    expect(accounts.find((a) => a.id === account.id)!.balance).toBe(uah(45_000));
  });

  it('коригування записується операцією і сходиться з історією', async () => {
    const { client } = await signUp();
    const account = await client.post<Account>('/api/accounts', {
      name: 'Готівка', type: 'cash', currency: 'UAH', initialBalance: uah(1000),
    });

    const result = await client.post<{ account: Account; transactionId: string }>(
      `/api/accounts/${account.id}/adjust`,
      { targetBalance: uah(750), note: 'Перерахував гаманець' },
    );

    expect(result.account.balance).toBe(uah(750));
    expect(result.transactionId).toBeTruthy();

    const list = await client.get<{ items: Transaction[] }>(`/api/transactions?accountId=${account.id}`);
    const adjustment = list.items.find((t) => t.kind === 'adjustment')!;
    expect(adjustment.amount).toBe(uah(-250));
  });

  it('не дає видалити рахунок з історією без підтвердження', async () => {
    const { client } = await signUp();
    const account = await client.post<Account>('/api/accounts', {
      name: 'З історією', type: 'card', currency: 'UAH', initialBalance: 0,
    });
    await client.post('/api/transactions', {
      kind: 'expense', accountId: account.id, amount: uah(100), occurredOn: '2026-11-01',
    });

    const blocked = await client.del(`/api/accounts/${account.id}`);
    expect(blocked.status).toBe(409);

    const forced = await client.del(`/api/accounts/${account.id}?force=true`);
    expect(forced.status).toBe(204);
  });
});

describe('перекази', () => {
  it('переміщує гроші без зміни капіталу', async () => {
    const { client } = await signUp();
    const from = await client.post<Account>('/api/accounts', {
      name: 'Звідки', type: 'card', currency: 'UAH', initialBalance: uah(10_000),
    });
    const to = await client.post<Account>('/api/accounts', {
      name: 'Куди', type: 'savings', currency: 'UAH', initialBalance: 0,
    });

    await client.post('/api/transactions', {
      kind: 'transfer', accountId: from.id, counterAccountId: to.id,
      amount: uah(2500), occurredOn: '2026-11-12',
    });

    const accounts = await client.get<Account[]>('/api/accounts');
    expect(accounts.find((a) => a.id === from.id)!.balance).toBe(uah(7500));
    expect(accounts.find((a) => a.id === to.id)!.balance).toBe(uah(2500));
  });

  it('вимагає суму зарахування для крос-валютного переказу', async () => {
    const { client } = await signUp();
    const uahAccount = await client.post<Account>('/api/accounts', {
      name: 'UAH', type: 'card', currency: 'UAH', initialBalance: uah(41_500),
    });
    const usdAccount = await client.post<Account>('/api/accounts', {
      name: 'USD', type: 'savings', currency: 'USD', initialBalance: 0,
    });

    const blocked = await client.request('POST', '/api/transactions', {
      kind: 'transfer', accountId: uahAccount.id, counterAccountId: usdAccount.id,
      amount: uah(41_500), occurredOn: '2026-11-12',
    });
    expect(blocked.status).toBe(400);

    await client.post('/api/transactions', {
      kind: 'transfer', accountId: uahAccount.id, counterAccountId: usdAccount.id,
      amount: uah(41_500), counterAmount: uah(1000), occurredOn: '2026-11-12',
    });

    const accounts = await client.get<Account[]>('/api/accounts');
    expect(accounts.find((a) => a.id === uahAccount.id)!.balance).toBe(0);
    expect(accounts.find((a) => a.id === usdAccount.id)!.balance).toBe(uah(1000));
  });
});

describe('регулярні операції', () => {
  it('матеріалізація одного повторення ідемпотентна', async () => {
    const { client } = await signUp();
    const account = await firstAccount(client);

    const rule = await client.post<{ id: string }>('/api/recurring', {
      kind: 'expense', accountId: account.id, amount: uah(15_000),
      freq: 'monthly', anchorDate: '2026-11-05', note: 'Оренда',
    });

    const first = await client.post<Transaction>(`/api/recurring/${rule.id}/materialize`, {
      occurrenceDate: '2026-12-05',
    });
    const second = await client.post<Transaction>(`/api/recurring/${rule.id}/materialize`, {
      occurrenceDate: '2026-12-05',
    });

    // Друге натискання повертає ту саму операцію, а не створює дубль.
    expect(second.id).toBe(first.id);

    const list = await client.get<{ items: Transaction[] }>('/api/transactions');
    expect(list.items.filter((t) => t.recurringOccurrence === '2026-12-05')).toHaveLength(1);
  });

  it('виняток скасовує одне повторення серії', async () => {
    const { client } = await signUp();
    const account = await firstAccount(client);

    const rule = await client.post<{ id: string }>('/api/recurring', {
      kind: 'expense', accountId: account.id, amount: uah(300),
      freq: 'monthly', anchorDate: '2026-11-20', note: 'Підписка',
    });

    await client.put(`/api/recurring/${rule.id}/occurrences`, {
      occurrenceDate: '2026-12-20',
      action: 'skip',
    });

    const ledger = await client.get<{ rules: unknown[]; exceptions: unknown[] }>(
      '/api/ledger?from=2026-11-01&to=2027-01-31',
    );
    expect(ledger.exceptions).toHaveLength(1);

    const blocked = await client.request('POST', `/api/recurring/${rule.id}/materialize`, {
      occurrenceDate: '2026-12-20',
    });
    expect(blocked.status).toBe(400);
  });
});

describe('кредити', () => {
  it('створює графік розстрочки 24 000 на 8 платежів', async () => {
    const { client } = await signUp();
    const account = await firstAccount(client);

    const created = await client.post<{
      loan: { id: string };
      schedule: Array<{ id: string; amount: number; dueOn: string; status: string }>;
      summary: { outstandingPrincipal: number; monthlyPayment: number; closingDate: string };
    }>('/api/loans', {
      name: 'Телефон у розстрочку',
      kind: 'installment',
      principal: uah(24_000),
      currency: 'UAH',
      openedOn: '2026-11-01',
      scheduleType: 'interest_free',
      paymentsCount: 8,
      firstPaymentOn: '2026-12-01',
      accountId: account.id,
    });

    expect(created.schedule).toHaveLength(8);
    expect(created.schedule.every((r) => r.amount === uah(3000))).toBe(true);
    expect(created.summary.outstandingPrincipal).toBe(uah(24_000));
    expect(created.summary.closingDate).toBe('2027-07-01');
  });

  it('платіж списує гроші рівно один раз і не повторюється', async () => {
    const { client } = await signUp();
    const account = await client.post<Account>('/api/accounts', {
      name: 'Кредитний', type: 'card', currency: 'UAH', initialBalance: uah(50_000),
    });

    const created = await client.post<{
      loan: { id: string };
      schedule: Array<{ id: string; amount: number }>;
    }>('/api/loans', {
      name: 'Розстрочка', kind: 'installment', principal: uah(24_000), currency: 'UAH',
      openedOn: '2026-11-01', scheduleType: 'interest_free', paymentsCount: 8,
      firstPaymentOn: '2026-12-01', accountId: account.id,
    });

    const firstRow = created.schedule[0]!;
    const afterPayment = await client.post<{
      summary: { outstandingPrincipal: number; progressPercent: number };
      schedule: Array<{ id: string; status: string }>;
    }>(`/api/loans/${created.loan.id}/payments`, {
      scheduleId: firstRow.id,
      paidOn: '2026-12-01',
      amount: firstRow.amount,
      kind: 'scheduled',
    });

    expect(afterPayment.summary.outstandingPrincipal).toBe(uah(21_000));
    expect(afterPayment.schedule.find((r) => r.id === firstRow.id)!.status).toBe('paid');

    const accounts = await client.get<Account[]>('/api/accounts');
    expect(accounts.find((a) => a.id === account.id)!.balance).toBe(uah(47_000));

    // Повторне проведення того самого рядка має бути відхилене.
    const duplicate = await client.request('POST', `/api/loans/${created.loan.id}/payments`, {
      scheduleId: firstRow.id, paidOn: '2026-12-01', amount: firstRow.amount, kind: 'scheduled',
    });
    expect(duplicate.status).toBe(400);

    const stillSame = await client.get<Account[]>('/api/accounts');
    expect(stillSame.find((a) => a.id === account.id)!.balance).toBe(uah(47_000));
  });

  it('скасування платежу прибирає і рух грошей', async () => {
    const { client } = await signUp();
    const account = await client.post<Account>('/api/accounts', {
      name: 'Кредитний', type: 'card', currency: 'UAH', initialBalance: uah(10_000),
    });
    const created = await client.post<{
      loan: { id: string }; schedule: Array<{ id: string; amount: number }>;
    }>('/api/loans', {
      name: 'Позика', kind: 'personal', principal: uah(3000), currency: 'UAH',
      openedOn: '2026-11-01', scheduleType: 'interest_free', paymentsCount: 1,
      firstPaymentOn: '2026-12-01', accountId: account.id,
    });

    await client.post<{ payments: Array<{ id: string }> }>(
      `/api/loans/${created.loan.id}/payments`,
      { scheduleId: created.schedule[0]!.id, paidOn: '2026-12-01', amount: uah(3000) },
    );
    const afterPay = await client.get<Account[]>('/api/accounts');
    expect(afterPay.find((a) => a.id === account.id)!.balance).toBe(uah(7000));

    const bundle = await client.get<{ payments: Array<{ id: string }> }>(
      `/api/loans/${created.loan.id}`,
    );
    const response = await client.del(
      `/api/loans/${created.loan.id}/payments/${bundle.payments[0]!.id}`,
    );
    expect(response.status).toBe(204);

    const restored = await client.get<Account[]>('/api/accounts');
    expect(restored.find((a) => a.id === account.id)!.balance).toBe(uah(10_000));
  });

  it('дострокове погашення зі скороченням строку перебудовує графік', async () => {
    const { client } = await signUp();
    const account = await client.post<Account>('/api/accounts', {
      name: 'Кредитний', type: 'card', currency: 'UAH', initialBalance: uah(200_000),
    });

    const created = await client.post<{
      loan: { id: string }; schedule: Array<{ id: string; amount: number; seq: number }>;
    }>('/api/loans', {
      name: 'Кредит', kind: 'loan', principal: uah(100_000), currency: 'UAH',
      openedOn: '2026-11-01', scheduleType: 'annuity', rateInput: 18, ratePeriod: 'annual',
      paymentsCount: 12, firstPaymentOn: '2026-12-05', accountId: account.id,
    });
    expect(created.schedule).toHaveLength(12);

    const result = await client.post<{
      schedule: Array<{ status: string }>;
      summary: { outstandingPrincipal: number };
    }>(`/api/loans/${created.loan.id}/payments`, {
      paidOn: '2026-12-10',
      amount: uah(40_000),
      kind: 'extra',
      earlyStrategy: 'reduce_term',
    });

    expect(result.summary.outstandingPrincipal).toBe(uah(60_000));
    const pending = result.schedule.filter((r) => r.status === 'pending');
    expect(pending.length).toBeLessThan(12);
  });
});

describe('bootstrap і ledger', () => {
  it('віддають усе потрібне для старту й календаря', async () => {
    const { client } = await signUp();
    const account = await firstAccount(client);

    await client.post('/api/recurring', {
      kind: 'income', accountId: account.id, amount: uah(40_000),
      freq: 'monthly', anchorDate: '2026-11-10', note: 'Зарплата',
    });
    await client.post('/api/loans', {
      name: 'Розстрочка', kind: 'installment', principal: uah(24_000), currency: 'UAH',
      openedOn: '2026-11-01', scheduleType: 'interest_free', paymentsCount: 8,
      firstPaymentOn: '2026-12-01', accountId: account.id,
    });

    const bootstrap = await client.get<{
      accounts: Account[]; categories: Category[];
      settings: { baseCurrency: string }; rates: Array<{ base: string }>;
      loans: Array<{ summary: { monthlyPayment: number } }>;
    }>('/api/bootstrap');

    expect(bootstrap.accounts.length).toBeGreaterThan(0);
    expect(bootstrap.settings.baseCurrency).toBe('UAH');
    expect(bootstrap.rates.length).toBeGreaterThan(0);
    expect(bootstrap.loans[0]!.summary.monthlyPayment).toBe(uah(3000));

    const ledger = await client.get<{
      transactions: unknown[]; rules: unknown[]; loanDues: Array<{ dueOn: string }>;
    }>('/api/ledger?from=2026-11-01&to=2027-07-31');

    expect(ledger.rules).toHaveLength(1);
    expect(ledger.loanDues).toHaveLength(8);
    expect(ledger.loanDues[0]!.dueOn).toBe('2026-12-01');
  });
});

describe('експорт та імпорт', () => {
  it('імпорт у режимі перегляду нічого не змінює', async () => {
    const { client } = await signUp();
    const account = await firstAccount(client);
    await client.post('/api/transactions', {
      kind: 'expense', accountId: account.id, amount: uah(500), occurredOn: '2026-11-02',
    });

    const backup = await client.get<Record<string, unknown>>('/api/export');
    const target = await signUp();

    const preview = await target.client.post<{ willAdd: { transactions: number }; applied: boolean }>(
      '/api/import',
      { mode: 'preview', payload: backup },
    );
    expect(preview.applied).toBe(false);
    expect(preview.willAdd.transactions).toBe(1);

    const before = await target.client.get<{ total: number }>('/api/transactions');
    expect(before.total).toBe(0);

    const applied = await target.client.post<{ applied: boolean }>('/api/import', {
      mode: 'apply',
      payload: backup,
    });
    expect(applied.applied).toBe(true);

    const after = await target.client.get<{ total: number }>('/api/transactions');
    expect(after.total).toBe(1);
  });

  it('повторний імпорт не створює дублів', async () => {
    const { client } = await signUp();
    const account = await firstAccount(client);
    await client.post('/api/transactions', {
      kind: 'expense', accountId: account.id, amount: uah(500), occurredOn: '2026-11-02',
    });
    const backup = await client.get<Record<string, unknown>>('/api/export');

    const target = await signUp();
    await target.client.post('/api/import', { mode: 'apply', payload: backup });
    await target.client.post('/api/import', { mode: 'apply', payload: backup });

    const after = await target.client.get<{ total: number }>('/api/transactions');
    expect(after.total).toBe(1);
  });

  it('експорт у CSV віддає файл', async () => {
    const { client } = await signUp();
    const response = await client.request('GET', '/api/export?format=csv');
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(await response.text()).toContain('occurred_on,kind,amount');
  });
});

describe('налаштування', () => {
  it('зберігає базову валюту, тему і курси', async () => {
    const { client } = await signUp();

    const updated = await client.patch<{ baseCurrency: string; theme: string }>('/api/settings', {
      baseCurrency: 'USD',
      theme: 'light',
      displayName: 'Ігор',
    });
    expect(updated.baseCurrency).toBe('USD');
    expect(updated.theme).toBe('light');

    const withRates = await client.put<{ rates: Array<{ base: string; rate: number }> }>(
      '/api/settings/rates',
      { rates: [{ base: 'EUR', quote: 'UAH', rate: 47.25 }] },
    );
    expect(withRates.rates.find((r) => r.base === 'EUR')!.rate).toBe(47.25);
  });
});

describe('видалення облікового запису', () => {
  it('прибирає всі дані користувача', async () => {
    const email = `del${Date.now()}@test.local`;
    const { client } = await signUp(email);
    const account = await firstAccount(client);
    await client.post('/api/transactions', {
      kind: 'expense', accountId: account.id, amount: uah(100), occurredOn: '2026-11-01',
    });

    expect((await client.del('/api/auth/account')).status).toBe(204);

    const retry = createClient();
    const login = await retry.request('POST', '/api/auth/login', {
      email,
      password: 'correct-horse-battery',
    });
    expect(login.status).toBe(401);
  });
});
