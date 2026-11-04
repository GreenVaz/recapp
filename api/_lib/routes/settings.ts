import { asUser } from '../db/types.ts';
import { json, readJson } from '../http.ts';
import { mapSettings } from '../mappers.ts';
import { ratesUpdateSchema, settingsUpdateSchema } from '../schemas.ts';
import { guarded } from '../router.ts';

async function readSettings(db: Parameters<typeof asUser>[0], userId: string) {
  return asUser(db, userId, async (c) => {
    const settings = await c.query(`select * from user_settings where user_id = $1`, [userId]);
    const profile = await c.query<{ display_name: string | null }>(
      `select display_name from profiles where user_id = $1`,
      [userId],
    );
    const rates = await c.query<{ base: string; quote: string; rate: string }>(
      `select base, quote, rate from exchange_rates order by base`,
    );

    return {
      ...mapSettings(settings.rows[0] ?? {}),
      displayName: profile.rows[0]?.display_name ?? null,
      rates: rates.rows.map((r) => ({ base: r.base, quote: r.quote, rate: Number(r.rate) })),
    };
  });
}

guarded('GET', '/api/settings', async ({ db, userId }) => json(await readSettings(db, userId)));

guarded('PATCH', '/api/settings', async ({ request, db, userId }) => {
  const input = settingsUpdateSchema.parse(await readJson(request));

  await asUser(db, userId, async (c) => {
    const columns: Array<[string, unknown]> = [];
    if (input.baseCurrency !== undefined) columns.push(['base_currency', input.baseCurrency]);
    if (input.theme !== undefined) columns.push(['theme', input.theme]);
    if (input.locale !== undefined) columns.push(['locale', input.locale]);
    if (input.weekStart !== undefined) columns.push(['week_start', input.weekStart]);

    if (columns.length > 0) {
      const assignments = columns.map(([key], i) => `${key} = $${i + 2}`).join(', ');
      await c.query(
        `update user_settings set ${assignments}, updated_at = now() where user_id = $1`,
        [userId, ...columns.map(([, value]) => value)],
      );
    }

    if (input.displayName !== undefined) {
      await c.query(
        `update profiles set display_name = $2, updated_at = now() where user_id = $1`,
        [userId, input.displayName],
      );
    }
  });

  return json(await readSettings(db, userId));
});

guarded('PUT', '/api/settings/rates', async ({ request, db, userId }) => {
  const { rates } = ratesUpdateSchema.parse(await readJson(request));

  await asUser(db, userId, async (c) => {
    for (const rate of rates) {
      if (rate.base === rate.quote) continue;
      await c.query(
        `insert into exchange_rates (user_id, base, quote, rate) values ($1,$2,$3,$4)
         on conflict (user_id, base, quote) do update
           set rate = excluded.rate, updated_at = now()`,
        [userId, rate.base, rate.quote, rate.rate],
      );
    }
  });

  return json(await readSettings(db, userId));
});
