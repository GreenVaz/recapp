import { asUser } from '../db/types.js';
import { badRequest, json, noContent, notFound, readJson } from '../http.js';
import { mapTransaction, toMoneyParam } from '../mappers.js';
import { transactionCreateSchema, transactionUpdateSchema } from '../schemas.js';
import { buildUpdate, defined } from '../sql.js';
import { guarded } from '../router.js';

guarded('GET', '/api/transactions', async ({ db, userId, url }) => {
  const sp = url.searchParams;
  const conditions: string[] = [];
  const values: unknown[] = [];

  const push = (clause: string, value: unknown) => {
    values.push(value);
    conditions.push(clause.replace('?', `$${values.length}`));
  };

  if (sp.get('from')) push('occurred_on >= ?', sp.get('from'));
  if (sp.get('to')) push('occurred_on <= ?', sp.get('to'));
  if (sp.get('accountId')) {
    values.push(sp.get('accountId'));
    conditions.push(`(account_id = $${values.length} or counter_account_id = $${values.length})`);
  }
  if (sp.get('categoryId')) push('category_id = ?', sp.get('categoryId'));
  if (sp.get('kind')) push('kind = ?', sp.get('kind'));
  if (sp.get('status')) push('status = ?', sp.get('status'));
  if (sp.get('q')) push('note ilike ?', `%${sp.get('q')}%`);

  const limit = Math.min(Number(sp.get('limit') ?? 200), 500);
  const offset = Math.max(Number(sp.get('offset') ?? 0), 0);
  const where = conditions.length ? `where ${conditions.join(' and ')}` : '';

  const result = await asUser(db, userId, async (c) => {
    const rows = await c.query(
      `select * from transactions ${where}
       order by occurred_on desc, created_at desc
       limit ${limit} offset ${offset}`,
      values,
    );
    const total = await c.query<{ count: string }>(
      `select count(*)::text as count from transactions ${where}`,
      values,
    );
    return { items: rows.rows.map(mapTransaction), total: Number(total.rows[0]?.count ?? 0), limit, offset };
  });

  return json(result);
});

guarded('POST', '/api/transactions', async ({ request, db, userId }) => {
  const input = transactionCreateSchema.parse(await readJson(request));

  const row = await asUser(db, userId, async (c) => {
    const accounts = await c.query<{ id: string; currency: string }>(
      `select id, currency from accounts where id = any($1)`,
      [[input.accountId, input.counterAccountId].filter(Boolean)],
    );
    const source = accounts.rows.find((a) => a.id === input.accountId);
    if (!source) throw notFound('Рахунок не знайдено');

    let counterAmount = input.counterAmount ?? null;
    if (input.kind === 'transfer') {
      const target = accounts.rows.find((a) => a.id === input.counterAccountId);
      if (!target) throw notFound('Рахунок призначення не знайдено');

      // Без явної суми зарахування крос-валютний переказ «створив» би або
      // знищив гроші на різниці курсів.
      if (target.currency !== source.currency && counterAmount === null) {
        throw badRequest(
          `Переказ ${source.currency} → ${target.currency}: вкажіть суму зарахування в ${target.currency}`,
        );
      }
      if (target.currency === source.currency) counterAmount = null;
    }

    const inserted = await c.query(
      `insert into transactions
         (user_id, account_id, kind, amount, currency, occurred_on, status, category_id,
          counter_account_id, counter_amount, note, tags, recurring_rule_id, recurring_occurrence)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       returning *`,
      [
        userId,
        input.accountId,
        input.kind,
        toMoneyParam(input.amount),
        source.currency,
        input.occurredOn,
        input.status,
        input.kind === 'transfer' ? null : (input.categoryId ?? null),
        input.kind === 'transfer' ? input.counterAccountId : null,
        counterAmount === null ? null : toMoneyParam(counterAmount),
        input.note ?? null,
        input.tags,
        input.recurringRuleId ?? null,
        input.recurringOccurrence ?? null,
      ],
    );
    return inserted.rows[0]!;
  });

  return json(mapTransaction(row), { status: 201 });
});

guarded('PATCH', '/api/transactions/:id', async ({ request, db, userId, params }) => {
  const input = transactionUpdateSchema.parse(await readJson(request));

  const row = await asUser(db, userId, async (c) => {
    const existing = await c.query(`select * from transactions where id = $1`, [params.id]);
    if (existing.rows.length === 0) throw notFound('Операцію не знайдено');
    const current = mapTransaction(existing.rows[0]!);

    const nextAccountId = input.accountId ?? current.accountId;
    const account = await c.query<{ currency: string }>(
      `select currency from accounts where id = $1`,
      [nextAccountId],
    );
    if (account.rows.length === 0) throw notFound('Рахунок не знайдено');

    const columns = defined({
      kind: input.kind,
      account_id: input.accountId,
      counter_account_id: input.counterAccountId,
      counter_amount: input.counterAmount === undefined
        ? undefined
        : input.counterAmount === null
          ? null
          : toMoneyParam(input.counterAmount),
      category_id: input.categoryId,
      amount: input.amount === undefined ? undefined : toMoneyParam(input.amount),
      occurred_on: input.occurredOn,
      status: input.status,
      note: input.note,
      tags: input.tags,
      // Валюта завжди слідує за рахунком, її не можна задати окремо.
      currency: input.accountId ? account.rows[0]!.currency : undefined,
    });

    const { text, values } = buildUpdate('transactions', columns);
    const updated = await c.query(text, [params.id, ...values]);
    return updated.rows[0]!;
  });

  return json(mapTransaction(row));
});

guarded('DELETE', '/api/transactions/:id', async ({ db, userId, params }) => {
  await asUser(db, userId, async (c) => {
    const deleted = await c.query(`delete from transactions where id = $1 returning id`, [params.id]);
    if (deleted.rows.length === 0) throw notFound('Операцію не знайдено');
  });
  return noContent();
});

/** Позначити заплановану операцію виконаною. */
guarded('POST', '/api/transactions/:id/post', async ({ db, userId, params }) => {
  const row = await asUser(db, userId, async (c) => {
    const updated = await c.query(
      `update transactions set status = 'posted', updated_at = now()
       where id = $1 and status = 'planned' returning *`,
      [params.id],
    );
    if (updated.rows.length === 0) {
      throw badRequest('Операцію не знайдено або вона вже проведена');
    }
    return updated.rows[0]!;
  });
  return json(mapTransaction(row));
});
