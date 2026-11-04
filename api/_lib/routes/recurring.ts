import { asUser } from '../db/types.ts';
import { badRequest, json, noContent, notFound, readJson } from '../http.ts';
import { mapException, mapRule, mapTransaction, toMoneyParam } from '../mappers.ts';
import { occurrenceEditSchema, recurringCreateSchema, recurringUpdateSchema } from '../schemas.ts';
import { buildUpdate, defined } from '../sql.ts';
import { guarded } from '../router.ts';
import { expandRule } from '../../../src/core/recurrence.ts';
import { z } from 'zod';

guarded('GET', '/api/recurring', async ({ db, userId }) => {
  const result = await asUser(db, userId, async (c) => {
    const rules = await c.query(`select * from recurring_rules order by is_active desc, anchor_date`);
    const exceptions = await c.query(`select * from recurring_exceptions`);
    return {
      rules: rules.rows.map(mapRule),
      exceptions: exceptions.rows.map(mapException),
    };
  });
  return json(result);
});

guarded('POST', '/api/recurring', async ({ request, db, userId }) => {
  const input = recurringCreateSchema.parse(await readJson(request));

  const row = await asUser(db, userId, async (c) => {
    const account = await c.query<{ currency: string }>(
      `select currency from accounts where id = $1`,
      [input.accountId],
    );
    if (account.rows.length === 0) throw notFound('Рахунок не знайдено');

    const inserted = await c.query(
      `insert into recurring_rules
         (user_id, kind, account_id, counter_account_id, category_id, amount, currency, note,
          freq, step, anchor_date, end_date, max_occurrences, month_end_policy, auto_post, is_active)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       returning *`,
      [
        userId,
        input.kind,
        input.accountId,
        input.kind === 'transfer' ? input.counterAccountId : null,
        input.kind === 'transfer' ? null : (input.categoryId ?? null),
        toMoneyParam(input.amount),
        account.rows[0]!.currency,
        input.note ?? null,
        input.freq,
        input.step,
        input.anchorDate,
        input.endDate ?? null,
        input.maxOccurrences ?? null,
        input.monthEndPolicy,
        input.autoPost,
        input.isActive,
      ],
    );
    return inserted.rows[0]!;
  });

  return json(mapRule(row), { status: 201 });
});

guarded('PATCH', '/api/recurring/:id', async ({ request, db, userId, params }) => {
  const input = recurringUpdateSchema.parse(await readJson(request));

  const columns = defined({
    kind: input.kind,
    account_id: input.accountId,
    counter_account_id: input.counterAccountId,
    category_id: input.categoryId,
    amount: input.amount === undefined ? undefined : toMoneyParam(input.amount),
    currency: input.currency,
    note: input.note,
    freq: input.freq,
    step: input.step,
    anchor_date: input.anchorDate,
    end_date: input.endDate,
    max_occurrences: input.maxOccurrences,
    month_end_policy: input.monthEndPolicy,
    auto_post: input.autoPost,
    is_active: input.isActive,
  });

  const row = await asUser(db, userId, async (c) => {
    const { text, values } = buildUpdate('recurring_rules', columns);
    const updated = await c.query(text, [params.id, ...values]);
    if (updated.rows.length === 0) throw notFound('Правило не знайдено');
    return updated.rows[0]!;
  });

  return json(mapRule(row));
});

guarded('DELETE', '/api/recurring/:id', async ({ db, userId, params, url }) => {
  // Уже матеріалізовані операції лишаються: це реальні рухи грошей,
  // і прибирати їх разом із правилом означало б переписати історію.
  const keepTransactions = url.searchParams.get('keepTransactions') !== 'false';

  await asUser(db, userId, async (c) => {
    if (!keepTransactions) {
      await c.query(`delete from transactions where recurring_rule_id = $1 and status = 'planned'`, [
        params.id,
      ]);
    }
    const deleted = await c.query(`delete from recurring_rules where id = $1 returning id`, [params.id]);
    if (deleted.rows.length === 0) throw notFound('Правило не знайдено');
  });

  return noContent();
});

/** Правка або скасування ОДНОГО повторення серії. */
guarded('PUT', '/api/recurring/:id/occurrences', async ({ request, db, userId, params }) => {
  const input = occurrenceEditSchema.parse(await readJson(request));

  const row = await asUser(db, userId, async (c) => {
    const rule = await c.query(`select id from recurring_rules where id = $1`, [params.id]);
    if (rule.rows.length === 0) throw notFound('Правило не знайдено');

    const upserted = await c.query(
      `insert into recurring_exceptions
         (user_id, rule_id, occurrence_date, action, new_date, new_amount, new_note)
       values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (rule_id, occurrence_date) do update
         set action = excluded.action,
             new_date = excluded.new_date,
             new_amount = excluded.new_amount,
             new_note = excluded.new_note
       returning *`,
      [
        userId,
        params.id,
        input.occurrenceDate,
        input.action,
        input.newDate ?? null,
        input.newAmount === undefined || input.newAmount === null ? null : toMoneyParam(input.newAmount),
        input.newNote ?? null,
      ],
    );
    return upserted.rows[0]!;
  });

  return json(mapException(row));
});

guarded('DELETE', '/api/recurring/:id/occurrences/:date', async ({ db, userId, params }) => {
  await asUser(db, userId, (c) =>
    c.query(`delete from recurring_exceptions where rule_id = $1 and occurrence_date = $2`, [
      params.id,
      params.date,
    ]),
  );
  return noContent();
});

const materializeSchema = z.object({
  occurrenceDate: z.iso.date(),
  status: z.enum(['planned', 'posted']).default('posted'),
  amount: z.number().int().positive().optional(),
  occurredOn: z.iso.date().optional(),
});

/**
 * Перетворює одне повторення на реальну операцію.
 *
 * Повторний виклик не створює дубля: унікальний індекс на
 * (rule_id, occurrence_date) робить це структурно неможливим, тож
 * подвійне натискання кнопки нічого не зламає.
 */
guarded('POST', '/api/recurring/:id/materialize', async ({ request, db, userId, params }) => {
  const input = materializeSchema.parse(await readJson(request));

  const row = await asUser(db, userId, async (c) => {
    const found = await c.query(`select * from recurring_rules where id = $1`, [params.id]);
    if (found.rows.length === 0) throw notFound('Правило не знайдено');
    const rule = mapRule(found.rows[0]!);

    const exceptions = await c.query(`select * from recurring_exceptions where rule_id = $1`, [params.id]);
    const occurrences = expandRule(
      rule,
      input.occurrenceDate,
      input.occurrenceDate,
      exceptions.rows.map(mapException),
    );
    const occurrence = occurrences.find((o) => o.occurrenceDate === input.occurrenceDate);
    if (!occurrence) throw badRequest('Такого повторення немає в серії');

    const existing = await c.query(
      `select * from transactions where recurring_rule_id = $1 and recurring_occurrence = $2`,
      [params.id, input.occurrenceDate],
    );
    if (existing.rows.length > 0) return existing.rows[0]!;

    const inserted = await c.query(
      `insert into transactions
         (user_id, account_id, kind, amount, currency, occurred_on, status, category_id,
          counter_account_id, note, recurring_rule_id, recurring_occurrence)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       returning *`,
      [
        userId,
        rule.accountId,
        rule.kind,
        toMoneyParam(input.amount ?? occurrence.amount),
        rule.currency,
        input.occurredOn ?? occurrence.date,
        input.status,
        rule.kind === 'transfer' ? null : rule.categoryId,
        rule.kind === 'transfer' ? rule.counterAccountId : null,
        occurrence.note,
        rule.id,
        input.occurrenceDate,
      ],
    );
    return inserted.rows[0]!;
  });

  return json(mapTransaction(row), { status: 201 });
});
