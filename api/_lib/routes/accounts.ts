import { asUser } from '../db/types.ts';
import { badRequest, conflict, json, noContent, notFound, readJson } from '../http.ts';
import { mapAccount, toMoneyParam } from '../mappers.ts';
import { accountCreateSchema, accountUpdateSchema, balanceAdjustSchema } from '../schemas.ts';
import { guarded } from '../router.ts';
import { today } from '../../../src/core/dates.ts';

const SELECT = `
  select a.*, coalesce(b.balance, a.initial_balance) as balance
  from accounts a
  left join account_balances b on b.account_id = a.id
`;

guarded('GET', '/api/accounts', async ({ db, userId }) => {
  const rows = await asUser(db, userId, (c) =>
    c.query(`${SELECT} order by a.is_archived, a.sort_order, a.created_at`),
  );
  return json(rows.rows.map(mapAccount));
});

guarded('POST', '/api/accounts', async ({ request, db, userId }) => {
  const input = accountCreateSchema.parse(await readJson(request));

  const row = await asUser(db, userId, async (c) => {
    const next = await c.query<{ next: string }>(
      `select coalesce(max(sort_order) + 1, 0) as next from accounts`,
    );
    const inserted = await c.query(
      `insert into accounts (user_id, name, type, currency, initial_balance, color, icon, sort_order)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [
        userId,
        input.name,
        input.type,
        input.currency,
        toMoneyParam(input.initialBalance),
        input.color,
        input.icon,
        Number(next.rows[0]?.next ?? 0),
      ],
    );
    const id = (inserted.rows[0] as { id: string }).id;
    const full = await c.query(`${SELECT} where a.id = $1`, [id]);
    return full.rows[0]!;
  });

  return json(mapAccount(row), { status: 201 });
});

guarded('PATCH', '/api/accounts/:id', async ({ request, db, userId, params }) => {
  const input = accountUpdateSchema.parse(await readJson(request));

  const columns: Record<string, unknown> = {};
  if (input.name !== undefined) columns.name = input.name;
  if (input.type !== undefined) columns.type = input.type;
  if (input.currency !== undefined) columns.currency = input.currency;
  if (input.initialBalance !== undefined) columns.initial_balance = toMoneyParam(input.initialBalance);
  if (input.color !== undefined) columns.color = input.color;
  if (input.icon !== undefined) columns.icon = input.icon;
  if (input.isArchived !== undefined) columns.is_archived = input.isArchived;
  if (input.sortOrder !== undefined) columns.sort_order = input.sortOrder;

  if (Object.keys(columns).length === 0) throw badRequest('Немає змін');

  const row = await asUser(db, userId, async (c) => {
    const keys = Object.keys(columns);
    const assignments = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');
    const updated = await c.query(
      `update accounts set ${assignments}, updated_at = now() where id = $1 returning id`,
      [params.id, ...keys.map((k) => columns[k])],
    );
    if (updated.rows.length === 0) throw notFound('Рахунок не знайдено');
    const full = await c.query(`${SELECT} where a.id = $1`, [params.id]);
    return full.rows[0]!;
  });

  return json(mapAccount(row));
});

guarded('DELETE', '/api/accounts/:id', async ({ db, userId, params, url }) => {
  const force = url.searchParams.get('force') === 'true';

  await asUser(db, userId, async (c) => {
    const used = await c.query<{ count: string }>(
      `select count(*)::text as count from transactions
       where account_id = $1 or counter_account_id = $1`,
      [params.id],
    );
    const count = Number(used.rows[0]?.count ?? 0);

    // Видалення каскадом знесло б історію, а разом з нею — і пояснення
    // поточних балансів інших рахунків. Пропонуємо архівацію.
    if (count > 0 && !force) {
      throw conflict(
        `На рахунку ${count} операцій. Заархівуйте його або підтвердіть видалення разом з історією.`,
        { transactions: count },
      );
    }

    const deleted = await c.query(`delete from accounts where id = $1 returning id`, [params.id]);
    if (deleted.rows.length === 0) throw notFound('Рахунок не знайдено');
  });

  return noContent();
});

/**
 * Коригування залишку. Користувач називає, скільки грошей є насправді,
 * а різниця записується окремою операцією — історія лишається повною.
 */
guarded('POST', '/api/accounts/:id/adjust', async ({ request, db, userId, params }) => {
  const input = balanceAdjustSchema.parse(await readJson(request));

  const result = await asUser(db, userId, async (c) => {
    const current = await c.query(`${SELECT} where a.id = $1`, [params.id]);
    const row = current.rows[0];
    if (!row) throw notFound('Рахунок не знайдено');

    const account = mapAccount(row);
    const delta = input.targetBalance - account.balance;
    if (delta === 0) return { account, transactionId: null as string | null };

    const inserted = await c.query<{ id: string }>(
      `insert into transactions (user_id, account_id, kind, amount, currency, occurred_on, note)
       values ($1,$2,'adjustment',$3,$4,$5,$6) returning id`,
      [
        userId,
        params.id,
        toMoneyParam(delta),
        account.currency,
        input.occurredOn ?? today(),
        input.note ?? 'Коригування залишку',
      ],
    );

    const updated = await c.query(`${SELECT} where a.id = $1`, [params.id]);
    return { account: mapAccount(updated.rows[0]!), transactionId: inserted.rows[0]!.id };
  });

  return json(result);
});
