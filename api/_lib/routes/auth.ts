import {
  clearSessionCookie,
  generateResetToken,
  hashPassword,
  hashResetToken,
  sessionCookie,
  signToken,
  verifyPassword,
} from '../auth.js';
import { asSystem, asUser, type Conn } from '../db/types.js';
import { DEFAULT_RATES, EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../defaults.js';
import { badRequest, json, noContent, readJson, unauthorized } from '../http.js';
import { sendPasswordReset } from '../mail.js';
import {
  changePasswordSchema,
  credentialsSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../schemas.js';
import { guarded, open } from '../router.js';

const RESET_TTL_MINUTES = 60;

async function seedWorkspace(c: Conn, userId: string): Promise<void> {
  await c.query(`insert into profiles (user_id) values ($1)`, [userId]);
  await c.query(`insert into user_settings (user_id) values ($1)`, [userId]);

  for (const rate of DEFAULT_RATES) {
    await c.query(
      `insert into exchange_rates (user_id, base, quote, rate) values ($1,$2,$3,$4)`,
      [userId, rate.base, rate.quote, rate.rate],
    );
  }

  await c.query(
    `insert into accounts (user_id, name, type, currency, initial_balance, color, icon, sort_order)
     values ($1, 'Картка', 'card', 'UAH', 0, '#2f6bff', 'CreditCard', 0)`,
    [userId],
  );

  const groups = [
    { list: EXPENSE_CATEGORIES, kind: 'expense' },
    { list: INCOME_CATEGORIES, kind: 'income' },
  ] as const;

  for (const { list, kind } of groups) {
    for (const [index, parent] of list.entries()) {
      const inserted = await c.query<{ id: string }>(
        `insert into categories (user_id, name, kind, icon, color, sort_order)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [userId, parent.name, kind, parent.icon, parent.color, index],
      );
      const parentId = inserted.rows[0]!.id;

      for (const [childIndex, child] of (parent.children ?? []).entries()) {
        await c.query(
          `insert into categories (user_id, name, kind, parent_id, icon, color, sort_order)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [userId, child.name, kind, parentId, child.icon, parent.color, childIndex],
        );
      }
    }
  }
}

async function sessionResponse(userId: string, tokenVersion: number, body: unknown): Promise<Response> {
  const token = await signToken(userId, tokenVersion);
  return json(body, { headers: { 'set-cookie': sessionCookie(token) } });
}

open('POST', '/api/auth/register', async ({ request, db }) => {
  const { email, password } = credentialsSchema.parse(await readJson(request));
  const passwordHash = await hashPassword(password);

  const userId = await asSystem(db, async (c) => {
    const existing = await c.query(`select id from users where lower(email) = lower($1)`, [email]);
    if (existing.rows.length > 0) {
      throw badRequest('Користувач із такою поштою вже існує');
    }

    const inserted = await c.query<{ id: string }>(
      `insert into users (email, password_hash) values ($1,$2) returning id`,
      [email.trim(), passwordHash],
    );
    const id = inserted.rows[0]!.id;

    // RLS вимагає контексту навіть у межах уже відкритої транзакції.
    await c.query('select set_config($1, $2, true)', ['app.user_id', id]);
    await seedWorkspace(c, id);
    return id;
  });

  return sessionResponse(userId, 0, { id: userId, email });
});

open('POST', '/api/auth/login', async ({ request, db }) => {
  const { email, password } = credentialsSchema.parse(await readJson(request));

  const user = await asSystem(db, async (c) => {
    const found = await c.query<{ id: string; password_hash: string; token_version: number }>(
      `select id, password_hash, token_version from users where lower(email) = lower($1)`,
      [email],
    );
    return found.rows[0] ?? null;
  });

  // Пароль перевіряємо навіть для неіснуючої пошти — щоб час відповіді
  // не підказував, які адреси зареєстровані.
  const dummy = 'pbkdf2$210000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const ok = await verifyPassword(password, user?.password_hash ?? dummy);

  if (!user || !ok) throw unauthorized('Невірна пошта або пароль');
  return sessionResponse(user.id, user.token_version, { id: user.id, email });
});

open('POST', '/api/auth/logout', async () =>
  noContent({ 'set-cookie': clearSessionCookie() }),
);

guarded('GET', '/api/auth/me', async ({ db, userId, tokenVersion }) => {
  const user = await asSystem(db, async (c) => {
    const found = await c.query<{ id: string; email: string; token_version: number }>(
      `select id, email, token_version from users where id = $1`,
      [userId],
    );
    return found.rows[0] ?? null;
  });

  // Зміна пароля інкрементує token_version — старі токени стають недійсними.
  if (!user || user.token_version !== tokenVersion) throw unauthorized('Сесія недійсна');

  const profile = await asUser(db, userId, async (c) => {
    const row = await c.query<{ display_name: string | null }>(
      `select display_name from profiles where user_id = $1`,
      [userId],
    );
    return row.rows[0] ?? null;
  });

  return json({ id: user.id, email: user.email, displayName: profile?.display_name ?? null });
});

guarded('POST', '/api/auth/password', async ({ request, db, userId }) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(await readJson(request));

  const result = await asSystem(db, async (c) => {
    const found = await c.query<{ password_hash: string; token_version: number }>(
      `select password_hash, token_version from users where id = $1`,
      [userId],
    );
    const user = found.rows[0];
    if (!user) throw unauthorized();

    if (!(await verifyPassword(currentPassword, user.password_hash))) {
      throw badRequest('Поточний пароль невірний');
    }

    const hash = await hashPassword(newPassword);
    const updated = await c.query<{ token_version: number }>(
      `update users set password_hash = $2, token_version = token_version + 1, updated_at = now()
       where id = $1 returning token_version`,
      [userId, hash],
    );
    return updated.rows[0]!.token_version;
  });

  // Видаємо свіжий токен, щоб поточний пристрій не вилетів із сесії.
  return sessionResponse(userId, result, { ok: true });
});

open('POST', '/api/auth/forgot', async ({ request, db }) => {
  const { email } = forgotPasswordSchema.parse(await readJson(request));

  const prepared = await asSystem(db, async (c) => {
    const found = await c.query<{ id: string }>(
      `select id from users where lower(email) = lower($1)`,
      [email],
    );
    const user = found.rows[0];
    if (!user) return null;

    const token = generateResetToken();
    const expires = new Date(Date.now() + RESET_TTL_MINUTES * 60_000).toISOString();
    await c.query(
      `insert into password_reset_tokens (user_id, token_hash, expires_at) values ($1,$2,$3)`,
      [user.id, await hashResetToken(token), expires],
    );
    return token;
  });

  const delivery = prepared ? await sendPasswordReset(email, prepared) : { sent: false, reason: null };

  // Відповідь однакова незалежно від того, чи існує адреса — інакше форма
  // перетворюється на перевірку наявності облікових записів.
  return json({
    ok: true,
    message: 'Якщо така пошта зареєстрована, лист із посиланням надіслано.',
    deliveryConfigured: delivery.sent || delivery.reason === null,
    ...(delivery.reason ? { warning: delivery.reason } : {}),
  });
});

open('POST', '/api/auth/reset', async ({ request, db }) => {
  const { token, password } = resetPasswordSchema.parse(await readJson(request));
  const tokenHash = await hashResetToken(token);

  await asSystem(db, async (c) => {
    const found = await c.query<{ id: string; user_id: string }>(
      `select id, user_id from password_reset_tokens
       where token_hash = $1 and used_at is null and expires_at > now()`,
      [tokenHash],
    );
    const row = found.rows[0];
    if (!row) throw badRequest('Посилання недійсне або прострочене');

    await c.query(`update password_reset_tokens set used_at = now() where id = $1`, [row.id]);
    await c.query(
      `update users set password_hash = $2, token_version = token_version + 1, updated_at = now()
       where id = $1`,
      [row.user_id, await hashPassword(password)],
    );
  });

  return json({ ok: true });
});

/** Повне видалення облікового запису разом з усіма даними. */
guarded('DELETE', '/api/auth/account', async ({ db, userId }) => {
  await asSystem(db, (c) => c.query(`delete from users where id = $1`, [userId]));
  return noContent({ 'set-cookie': clearSessionCookie() });
});
