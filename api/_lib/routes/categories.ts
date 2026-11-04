import { asUser } from '../db/types.ts';
import { badRequest, json, noContent, notFound, readJson } from '../http.ts';
import { mapCategory } from '../mappers.ts';
import { categoryCreateSchema, categoryUpdateSchema } from '../schemas.ts';
import { buildUpdate, defined } from '../sql.ts';
import { guarded } from '../router.ts';

guarded('GET', '/api/categories', async ({ db, userId, url }) => {
  const kind = url.searchParams.get('kind');
  const rows = await asUser(db, userId, (c) =>
    kind
      ? c.query(`select * from categories where kind = $1 order by sort_order, name`, [kind])
      : c.query(`select * from categories order by kind, sort_order, name`),
  );
  return json(rows.rows.map(mapCategory));
});

guarded('POST', '/api/categories', async ({ request, db, userId }) => {
  const input = categoryCreateSchema.parse(await readJson(request));

  const row = await asUser(db, userId, async (c) => {
    if (input.parentId) {
      const parent = await c.query<{ kind: string; parent_id: string | null }>(
        `select kind, parent_id from categories where id = $1`,
        [input.parentId],
      );
      const found = parent.rows[0];
      if (!found) throw notFound('Батьківську категорію не знайдено');
      if (found.parent_id) throw badRequest('Підтримується лише два рівні категорій');
      if (found.kind !== input.kind) throw badRequest('Тип підкатегорії має збігатися з батьківським');
    }

    const next = await c.query<{ next: string }>(
      `select coalesce(max(sort_order) + 1, 0) as next from categories
       where kind = $1 and parent_id is not distinct from $2`,
      [input.kind, input.parentId ?? null],
    );

    const inserted = await c.query(
      `insert into categories (user_id, name, kind, parent_id, icon, color, sort_order)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [
        userId,
        input.name,
        input.kind,
        input.parentId ?? null,
        input.icon,
        input.color,
        Number(next.rows[0]?.next ?? 0),
      ],
    );
    return inserted.rows[0]!;
  });

  return json(mapCategory(row), { status: 201 });
});

guarded('PATCH', '/api/categories/:id', async ({ request, db, userId, params }) => {
  const input = categoryUpdateSchema.parse(await readJson(request));

  const columns = defined({
    name: input.name,
    kind: input.kind,
    parent_id: input.parentId,
    icon: input.icon,
    color: input.color,
    is_archived: input.isArchived,
    sort_order: input.sortOrder,
  });

  const row = await asUser(db, userId, async (c) => {
    if (input.parentId === params.id) throw badRequest('Категорія не може бути власним батьком');

    const { text, values } = buildUpdate('categories', columns);
    const updated = await c.query(text, [params.id, ...values]);
    if (updated.rows.length === 0) throw notFound('Категорію не знайдено');
    return updated.rows[0]!;
  });

  return json(mapCategory(row));
});

guarded('DELETE', '/api/categories/:id', async ({ db, userId, params }) => {
  await asUser(db, userId, async (c) => {
    // Транзакції лишаються, category_id стає null (on delete set null).
    const deleted = await c.query(`delete from categories where id = $1 returning id`, [params.id]);
    if (deleted.rows.length === 0) throw notFound('Категорію не знайдено');
  });
  return noContent();
});
