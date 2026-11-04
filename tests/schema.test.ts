import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PGliteDatabase } from './pglite.ts';
import { asUser } from '../api/_lib/db/types.ts';

/**
 * Перевіряє інваріанти, які тримає сама БД, а не код застосунку.
 * Якщо ці тести зелені — жоден баг у хендлерах не зможе порушити
 * ізоляцію користувачів або створити подвійне списання.
 */

let db: PGliteDatabase;
let alice: string;
let bob: string;

beforeAll(async () => {
  db = await PGliteDatabase.create();
  [alice, bob] = await db.tx(async (c) => {
    const a = await c.query<{ id: string }>(
      `insert into users (email, password_hash) values ('alice@test.local','x') returning id`,
    );
    const b = await c.query<{ id: string }>(
      `insert into users (email, password_hash) values ('bob@test.local','x') returning id`,
    );
    return [a.rows[0]!.id, b.rows[0]!.id];
  });
});

afterAll(async () => {
  await db?.close();
});

async function makeAccount(user: string, initial = 0, name = 'Картка') {
  return asUser(db, user, async (c) => {
    const r = await c.query<{ id: string }>(
      `insert into accounts (user_id, name, type, currency, initial_balance)
       values ($1, $2, 'card', 'UAH', $3) returning id`,
      [user, name, initial],
    );
    return r.rows[0]!.id;
  });
}

describe('row level security', () => {
  it('ізолює рахунки між користувачами', async () => {
    await makeAccount(alice, 1000, 'Alice картка');

    const bobSees = await asUser(db, bob, (c) => c.query(`select * from accounts`));
    expect(bobSees.rows).toHaveLength(0);

    const aliceSees = await asUser(db, alice, (c) => c.query(`select * from accounts`));
    expect(aliceSees.rows.length).toBeGreaterThan(0);
  });

  it('під роллю app_rls без app.user_id не віддає жодного рядка', async () => {
    // Саме так виглядає запит, у якому код забув виставити контекст:
    // роль застосунку є, ідентифікатора користувача немає — RLS відсікає все.
    const res = await db.tx(async (c) => {
      await c.query('set local role app_rls');
      return c.query(`select * from accounts`);
    });
    expect(res.rows).toHaveLength(0);
  });

  it('роль-власник бачить усе — нею користується лише автентифікація', async () => {
    // Задокументована межа моделі: asSystem() застосовується тільки для
    // таблиці users, яку app_rls не має права читати взагалі.
    const res = await db.tx((c) => c.query(`select * from accounts`));
    expect(res.rows.length).toBeGreaterThan(0);
  });

  it('app_rls не має доступу до таблиці облікових записів', async () => {
    await expect(
      db.tx(async (c) => {
        await c.query('set local role app_rls');
        return c.query(`select * from users`);
      }),
    ).rejects.toThrow();
  });

  it('застосовує RLS і до view балансів', async () => {
    const res = await asUser(db, bob, (c) => c.query(`select * from account_balances`));
    expect(res.rows).toHaveLength(0);
  });

  it('забороняє вставити рядок від імені чужого користувача', async () => {
    await expect(
      asUser(db, bob, (c) =>
        c.query(
          `insert into accounts (user_id, name, type, currency) values ($1,'Чужий','card','UAH')`,
          [alice],
        ),
      ),
    ).rejects.toThrow();
  });
});

describe('account_balances', () => {
  it('рахує баланс із початкового залишку та проведених операцій', async () => {
    const acc = await makeAccount(alice, 20_000, 'Баланс-тест');

    await asUser(db, alice, async (c) => {
      await c.query(
        `insert into transactions (user_id, account_id, kind, amount, currency, occurred_on)
         values ($1,$2,'income',40000,'UAH','2026-11-10')`,
        [alice, acc],
      );
      await c.query(
        `insert into transactions (user_id, account_id, kind, amount, currency, occurred_on)
         values ($1,$2,'expense',15000,'UAH','2026-11-05')`,
        [alice, acc],
      );
      // Запланована операція НЕ впливає на фактичний баланс.
      await c.query(
        `insert into transactions (user_id, account_id, kind, amount, currency, occurred_on, status)
         values ($1,$2,'expense',3000,'UAH','2026-12-05','planned')`,
        [alice, acc],
      );
    });

    const res = await asUser(db, alice, (c) =>
      c.query<{ balance: string }>(`select balance from account_balances where account_id=$1`, [acc]),
    );
    expect(res.rows[0]!.balance).toBe('45000.00');
  });

  it('переказ між рахунками не створює і не знищує грошей', async () => {
    const from = await makeAccount(alice, 10_000, 'Звідки');
    const to = await makeAccount(alice, 0, 'Куди');

    await asUser(db, alice, (c) =>
      c.query(
        `insert into transactions (user_id, account_id, kind, amount, currency, occurred_on, counter_account_id)
         values ($1,$2,'transfer',2500,'UAH','2026-11-12',$3)`,
        [alice, from, to],
      ),
    );

    const rows = await asUser(db, alice, (c) =>
      c.query<{ account_id: string; balance: string }>(
        `select account_id, balance from account_balances where account_id = any($1)`,
        [[from, to]],
      ),
    );
    const byId = Object.fromEntries(rows.rows.map((r) => [r.account_id, r.balance]));
    expect(byId[from]).toBe('7500.00');
    expect(byId[to]).toBe('2500.00');
  });

  it('крос-валютний переказ зараховує вказану суму призначення', async () => {
    const uah = await makeAccount(alice, 41_500, 'UAH рахунок');
    const usd = await asUser(db, alice, async (c) => {
      const r = await c.query<{ id: string }>(
        `insert into accounts (user_id,name,type,currency,initial_balance)
         values ($1,'USD банка','savings','USD',0) returning id`,
        [alice],
      );
      return r.rows[0]!.id;
    });

    await asUser(db, alice, (c) =>
      c.query(
        `insert into transactions (user_id, account_id, kind, amount, currency, occurred_on,
                                   counter_account_id, counter_amount)
         values ($1,$2,'transfer',41500,'UAH','2026-11-12',$3,1000)`,
        [alice, uah, usd],
      ),
    );

    const rows = await asUser(db, alice, (c) =>
      c.query<{ account_id: string; balance: string }>(
        `select account_id, balance from account_balances where account_id = any($1)`,
        [[uah, usd]],
      ),
    );
    const byId = Object.fromEntries(rows.rows.map((r) => [r.account_id, r.balance]));
    expect(byId[uah]).toBe('0.00');
    expect(byId[usd]).toBe('1000.00');
  });

  it('коригування залишку записується знаковою транзакцією', async () => {
    const acc = await makeAccount(alice, 1000, 'Коригування');
    await asUser(db, alice, (c) =>
      c.query(
        `insert into transactions (user_id, account_id, kind, amount, currency, occurred_on, note)
         values ($1,$2,'adjustment',-250,'UAH','2026-11-01','Загубив готівку')`,
        [alice, acc],
      ),
    );
    const res = await asUser(db, alice, (c) =>
      c.query<{ balance: string }>(`select balance from account_balances where account_id=$1`, [acc]),
    );
    expect(res.rows[0]!.balance).toBe('750.00');
  });
});

describe('інваріанти схеми', () => {
  it('дозволяє рівно два рівні категорій', async () => {
    await asUser(db, alice, async (c) => {
      const parent = (
        await c.query<{ id: string }>(
          `insert into categories (user_id,name,kind) values ($1,'Житло','expense') returning id`,
          [alice],
        )
      ).rows[0]!.id;
      const child = (
        await c.query<{ id: string }>(
          `insert into categories (user_id,name,kind,parent_id) values ($1,'Оренда','expense',$2) returning id`,
          [alice, parent],
        )
      ).rows[0]!.id;

      await expect(
        c.query(`insert into categories (user_id,name,kind,parent_id) values ($1,'Глибше','expense',$2)`, [
          alice,
          child,
        ]),
      ).rejects.toThrow(/два рівні/);
    });
  });

  it('не дає матеріалізувати одне повторення серії двічі', async () => {
    const acc = await makeAccount(alice, 0, 'Регулярні');
    await expect(
      asUser(db, alice, async (c) => {
        const rule = (
          await c.query<{ id: string }>(
            `insert into recurring_rules (user_id,kind,account_id,amount,currency,freq,anchor_date)
             values ($1,'expense',$2,15000,'UAH','monthly','2026-11-05') returning id`,
            [alice, acc],
          )
        ).rows[0]!.id;

        const insert = () =>
          c.query(
            `insert into transactions (user_id,account_id,kind,amount,currency,occurred_on,
                                       recurring_rule_id,recurring_occurrence)
             values ($1,$2,'expense',15000,'UAH','2026-11-05',$3,'2026-11-05')`,
            [alice, acc, rule],
          );
        await insert();
        await insert();
      }),
    ).rejects.toThrow();
  });

  it('не дає закрити один рядок графіка кредиту двома плановими платежами', async () => {
    await expect(
      asUser(db, alice, async (c) => {
        const loan = (
          await c.query<{ id: string }>(
            `insert into loans (user_id,name,principal,currency,opened_on,schedule_type,first_payment_on)
             values ($1,'Розстрочка',24000,'UAH','2026-11-01','interest_free','2026-12-01') returning id`,
            [alice],
          )
        ).rows[0]!.id;
        const sched = (
          await c.query<{ id: string }>(
            `insert into loan_payment_schedules (user_id,loan_id,seq,due_on,amount,principal_part,balance_after)
             values ($1,$2,1,'2026-12-01',3000,3000,21000) returning id`,
            [alice, loan],
          )
        ).rows[0]!.id;

        const pay = () =>
          c.query(
            `insert into loan_payments (user_id,loan_id,schedule_id,paid_on,amount,principal_part,kind)
             values ($1,$2,$3,'2026-12-01',3000,3000,'scheduled')`,
            [alice, loan, sched],
          );
        await pay();
        await pay();
      }),
    ).rejects.toThrow();
  });

  it('не дає прив’язати дві виплати до однієї транзакції', async () => {
    const acc = await makeAccount(alice, 0, 'Подвійне списання');
    await expect(
      asUser(db, alice, async (c) => {
        const loan = (
          await c.query<{ id: string }>(
            `insert into loans (user_id,name,principal,currency,opened_on,schedule_type,first_payment_on)
             values ($1,'Кредит',10000,'UAH','2026-11-01','annuity','2026-12-01') returning id`,
            [alice],
          )
        ).rows[0]!.id;
        const tx = (
          await c.query<{ id: string }>(
            `insert into transactions (user_id,account_id,kind,amount,currency,occurred_on)
             values ($1,$2,'expense',1000,'UAH','2026-12-01') returning id`,
            [alice, acc],
          )
        ).rows[0]!.id;

        const link = () =>
          c.query(
            `insert into loan_payments (user_id,loan_id,transaction_id,paid_on,amount,kind)
             values ($1,$2,$3,'2026-12-01',1000,'extra')`,
            [alice, loan, tx],
          );
        await link();
        await link();
      }),
    ).rejects.toThrow();
  });

  it('відхиляє переказ сам на себе', async () => {
    const acc = await makeAccount(alice, 100, 'Сам на себе');
    await expect(
      asUser(db, alice, (c) =>
        c.query(
          `insert into transactions (user_id,account_id,kind,amount,currency,occurred_on,counter_account_id)
           values ($1,$2,'transfer',10,'UAH','2026-11-01',$2)`,
          [alice, acc],
        ),
      ),
    ).rejects.toThrow();
  });

  it('відхиляє від’ємну або нульову суму витрати', async () => {
    const acc = await makeAccount(alice, 100, 'Нульова сума');
    await expect(
      asUser(db, alice, (c) =>
        c.query(
          `insert into transactions (user_id,account_id,kind,amount,currency,occurred_on)
           values ($1,$2,'expense',0,'UAH','2026-11-01')`,
          [alice, acc],
        ),
      ),
    ).rejects.toThrow();
  });
});
