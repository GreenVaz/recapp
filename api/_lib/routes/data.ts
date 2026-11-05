import { asUser, type Conn } from '../db/types.js';
import { badRequest, json } from '../http.js';
import {
  mapAccount,
  mapCategory,
  mapException,
  mapLoan,
  mapLoanPayment,
  mapRule,
  mapScheduleRow,
  mapSettings,
  mapTransaction,
} from '../mappers.js';
import { rangeSchema } from '../schemas.js';
import { guarded } from '../router.js';
import { summarizeLoan } from '../../../src/core/loans.js';

const EXPORT_VERSION = 1;

const ACCOUNTS_WITH_BALANCE = `
  select a.*, coalesce(b.balance, a.initial_balance) as balance
  from accounts a
  left join account_balances b on b.account_id = a.id
`;

/**
 * Запити йдуть по черзі, а не через Promise.all.
 *
 * Conn — це одне з'єднання. Паралельні виклики `query()` на ньому
 * node-postgres ставить у ту саму чергу, тож виграшу в швидкості немає
 * взагалі, зате є попередження про використання клієнта, який уже
 * виконує запит, — а в pg@9 така поведінка зникне зовсім.
 */
async function loadWorkspace(c: Conn, userId: string) {
  const accounts = await c.query(`${ACCOUNTS_WITH_BALANCE} order by a.is_archived, a.sort_order`);
  const categories = await c.query(`select * from categories order by kind, sort_order, name`);
  const settings = await c.query(`select * from user_settings where user_id = $1`, [userId]);
  const profile = await c.query<{ display_name: string | null }>(
    `select display_name from profiles where user_id = $1`,
    [userId],
  );
  const rates = await c.query<{ base: string; quote: string; rate: string }>(
    `select base, quote, rate from exchange_rates`,
  );

  return {
    accounts: accounts.rows.map(mapAccount),
    categories: categories.rows.map(mapCategory),
    settings: mapSettings(settings.rows[0] ?? {}),
    displayName: profile.rows[0]?.display_name ?? null,
    rates: rates.rows.map((r) => ({ base: r.base, quote: r.quote, rate: Number(r.rate) })),
  };
}

/**
 * Один запит, який повертає все потрібне для старту застосунку.
 * Менше кругових поїздок — швидший перший екран на мобільному зв'язку.
 */
guarded('GET', '/api/bootstrap', async ({ db, userId }) => {
  const result = await asUser(db, userId, async (c) => {
    const workspace = await loadWorkspace(c, userId);

    const loans = await c.query(`select * from loans order by is_closed, created_at desc`);
    const schedules = await c.query(`select * from loan_payment_schedules order by seq`);
    const payments = await c.query(`select * from loan_payments order by paid_on`);

    const scheduleByLoan = new Map<string, ReturnType<typeof mapScheduleRow>[]>();
    for (const row of schedules.rows) {
      const id = String(row.loan_id);
      scheduleByLoan.set(id, [...(scheduleByLoan.get(id) ?? []), mapScheduleRow(row)]);
    }
    const paymentsByLoan = new Map<string, ReturnType<typeof mapLoanPayment>[]>();
    for (const row of payments.rows) {
      const id = String(row.loan_id);
      paymentsByLoan.set(id, [...(paymentsByLoan.get(id) ?? []), mapLoanPayment(row)]);
    }

    return {
      ...workspace,
      loans: loans.rows.map((row) => {
        const loan = mapLoan(row);
        const schedule = scheduleByLoan.get(loan.id) ?? [];
        const loanPayments = paymentsByLoan.get(loan.id) ?? [];
        return { loan, schedule, payments: loanPayments, summary: summarizeLoan(loan, schedule, loanPayments) };
      }),
    };
  });

  return json(result);
});

/**
 * Сирі дані для прогнозу за період. Рушій рахує на клієнті, тож сервер
 * лише віддає факти — так календар, головна й аналітика гарантовано
 * показують однакові числа.
 */
guarded('GET', '/api/ledger', async ({ db, userId, url }) => {
  const { from, to } = rangeSchema.parse({
    from: url.searchParams.get('from'),
    to: url.searchParams.get('to'),
  });
  if (from > to) throw badRequest('Початок періоду пізніше за кінець');

  const result = await asUser(db, userId, async (c) => {
    // По черзі: одне з'єднання, паралельність уявна (див. loadWorkspace).
    const transactions = await c.query(
      `select * from transactions where occurred_on between $1 and $2
         order by occurred_on, created_at`,
      [from, to],
    );
    const rules = await c.query(`select * from recurring_rules where is_active`);
    const exceptions = await c.query(`select * from recurring_exceptions`);
    const dues = await c.query(
        `select s.*, l.name as loan_name, l.currency as loan_currency,
                l.account_id as loan_account_id, l.category_id as loan_category_id
         from loan_payment_schedules s
         join loans l on l.id = s.loan_id
         where s.due_on between $1 and $2 and s.status in ('pending','partial')
         order by s.due_on`,
      [from, to],
    );

    return {
      from,
      to,
      transactions: transactions.rows.map(mapTransaction),
      rules: rules.rows.map(mapRule),
      exceptions: exceptions.rows.map(mapException),
      loanDues: dues.rows.map((row) => ({
        loanId: String(row.loan_id),
        loanName: String(row.loan_name),
        currency: String(row.loan_currency),
        accountId: row.loan_account_id ? String(row.loan_account_id) : null,
        categoryId: row.loan_category_id ? String(row.loan_category_id) : null,
        ...mapScheduleRow(row),
      })),
    };
  });

  return json(result);
});

// ─── Експорт та імпорт ──────────────────────────────────────────────────

guarded('GET', '/api/export', async ({ db, userId, url }) => {
  const format = url.searchParams.get('format') ?? 'json';

  const data = await asUser(db, userId, async (c) => {
    // По черзі: одне з'єднання, паралельність уявна (див. loadWorkspace).
    const accounts = await c.query(`select * from accounts order by sort_order`);
    const categories = await c.query(`select * from categories order by kind, sort_order`);
    const transactions = await c.query(`select * from transactions order by occurred_on`);
    const rules = await c.query(`select * from recurring_rules`);
    const exceptions = await c.query(`select * from recurring_exceptions`);
    const loans = await c.query(`select * from loans`);
    const schedules = await c.query(`select * from loan_payment_schedules order by loan_id, seq`);
    const payments = await c.query(`select * from loan_payments order by paid_on`);
    const rates = await c.query(`select * from exchange_rates`);
    const settings = await c.query(`select * from user_settings where user_id = $1`, [userId]);

    return {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      accounts: accounts!.rows,
      categories: categories!.rows,
      transactions: transactions!.rows,
      recurringRules: rules!.rows,
      recurringExceptions: exceptions!.rows,
      loans: loans!.rows,
      loanSchedules: schedules!.rows,
      loanPayments: payments!.rows,
      exchangeRates: rates!.rows,
      settings: settings!.rows[0] ?? null,
    };
  });

  if (format === 'csv') {
    return new Response(transactionsToCsv(data.transactions as Record<string, unknown>[]), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return json(data, {
    headers: {
      'content-disposition': `attachment; filename="finance-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
});

function transactionsToCsv(rows: Record<string, unknown>[]): string {
  const columns = [
    'occurred_on', 'kind', 'amount', 'currency', 'status',
    'account_id', 'counter_account_id', 'category_id', 'note', 'tags',
  ];

  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = Array.isArray(value) ? value.join(' ') : String(value);
    // Клітинка з комою, лапками чи переносом має бути в лапках.
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };

  return [
    columns.join(','),
    ...rows.map((row) => columns.map((col) => escape(row[col])).join(',')),
  ].join('\n');
}
