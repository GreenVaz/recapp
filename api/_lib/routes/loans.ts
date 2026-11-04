import { asUser, type Conn } from '../db/types.ts';
import { badRequest, json, noContent, notFound, readJson } from '../http.ts';
import {
  mapLoan,
  mapLoanPayment,
  mapScheduleRow,
  toMoneyParam,
} from '../mappers.ts';
import { loanCreateSchema, loanPaymentSchema, loanUpdateSchema } from '../schemas.ts';
import { buildUpdate, defined } from '../sql.ts';
import { guarded, pathParam } from '../router.ts';
import {
  allocatePayment,
  buildSchedule,
  rebuildRemaining,
  summarizeLoan,
  type ScheduleSpec,
} from '../../../src/core/loans.ts';
import type { Loan, ScheduleRow } from '../../../src/core/types.ts';

/** Ставку користувач вводить річну або місячну — усередині завжди річна. */
function normalizeRate(rateInput: number | null | undefined, period: string | null | undefined): number | null {
  if (rateInput === null || rateInput === undefined) return null;
  return period === 'monthly' ? rateInput * 12 : rateInput;
}

function specFor(loan: Loan, manualRows?: ScheduleSpec['manualRows']): ScheduleSpec {
  return {
    principal: loan.principal,
    rateAnnual: loan.rateAnnual,
    scheduleType: loan.scheduleType,
    paymentsCount: loan.paymentsCount ?? loan.termMonths ?? 0,
    firstPaymentOn: loan.firstPaymentOn,
    paymentDay: loan.paymentDay,
    totalDue: loan.totalDue,
    feeFixed: loan.feeFixed,
    feePercent: loan.feePercent,
    ...(manualRows ? { manualRows } : {}),
  };
}

async function insertSchedule(
  c: Conn,
  userId: string,
  loanId: string,
  rows: ScheduleRow[],
): Promise<void> {
  for (const row of rows) {
    await c.query(
      `insert into loan_payment_schedules
         (user_id, loan_id, seq, due_on, amount, principal_part, interest_part, fee_part,
          balance_after, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        userId,
        loanId,
        row.seq,
        row.dueOn,
        toMoneyParam(row.amount),
        toMoneyParam(row.principalPart),
        toMoneyParam(row.interestPart),
        toMoneyParam(row.feePart),
        toMoneyParam(row.balanceAfter),
        row.status,
      ],
    );
  }
}

async function loadLoanBundle(c: Conn, loanId: string) {
  const loanRow = await c.query(`select * from loans where id = $1`, [loanId]);
  if (loanRow.rows.length === 0) throw notFound('Кредит не знайдено');

  const schedule = await c.query(
    `select * from loan_payment_schedules where loan_id = $1 order by seq`,
    [loanId],
  );
  const payments = await c.query(
    `select * from loan_payments where loan_id = $1 order by paid_on, created_at`,
    [loanId],
  );

  return {
    loan: mapLoan(loanRow.rows[0]!),
    schedule: schedule.rows.map(mapScheduleRow),
    payments: payments.rows.map(mapLoanPayment),
  };
}

guarded('GET', '/api/loans', async ({ db, userId }) => {
  const result = await asUser(db, userId, async (c) => {
    const loans = await c.query(`select * from loans order by is_closed, created_at desc`);
    const schedules = await c.query(`select * from loan_payment_schedules order by seq`);
    const payments = await c.query(`select * from loan_payments order by paid_on`);

    const byLoanSchedule = new Map<string, ReturnType<typeof mapScheduleRow>[]>();
    for (const row of schedules.rows) {
      const loanId = String(row.loan_id);
      byLoanSchedule.set(loanId, [...(byLoanSchedule.get(loanId) ?? []), mapScheduleRow(row)]);
    }

    const byLoanPayments = new Map<string, ReturnType<typeof mapLoanPayment>[]>();
    for (const row of payments.rows) {
      const loanId = String(row.loan_id);
      byLoanPayments.set(loanId, [...(byLoanPayments.get(loanId) ?? []), mapLoanPayment(row)]);
    }

    return loans.rows.map((row) => {
      const loan = mapLoan(row);
      const schedule = byLoanSchedule.get(loan.id) ?? [];
      const loanPayments = byLoanPayments.get(loan.id) ?? [];
      return { loan, schedule, payments: loanPayments, summary: summarizeLoan(loan, schedule, loanPayments) };
    });
  });

  return json(result);
});

guarded('GET', '/api/loans/:id', async ({ db, userId, params }) => {
  const bundle = await asUser(db, userId, (c) => loadLoanBundle(c, pathParam(params, 'id')));
  return json({ ...bundle, summary: summarizeLoan(bundle.loan, bundle.schedule, bundle.payments) });
});

guarded('POST', '/api/loans', async ({ request, db, userId }) => {
  const input = loanCreateSchema.parse(await readJson(request));
  const rateAnnual = normalizeRate(input.rateInput, input.ratePeriod);

  const result = await asUser(db, userId, async (c) => {
    const inserted = await c.query(
      `insert into loans
         (user_id, name, lender, kind, principal, currency, opened_on, term_months,
          rate_input, rate_period, rate_annual, schedule_type, payment_day, first_payment_on,
          payments_count, total_due, fee_fixed, fee_percent, account_id, category_id, note)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       returning *`,
      [
        userId,
        input.name,
        input.lender ?? null,
        input.kind,
        toMoneyParam(input.principal),
        input.currency,
        input.openedOn,
        input.termMonths ?? null,
        input.rateInput ?? null,
        input.ratePeriod ?? null,
        rateAnnual,
        input.scheduleType,
        input.paymentDay ?? null,
        input.firstPaymentOn,
        input.paymentsCount ?? input.termMonths ?? null,
        input.totalDue === null || input.totalDue === undefined ? null : toMoneyParam(input.totalDue),
        toMoneyParam(input.feeFixed),
        input.feePercent,
        input.accountId ?? null,
        input.categoryId ?? null,
        input.note ?? null,
      ],
    );

    const loan = mapLoan(inserted.rows[0]!);
    const rows = buildSchedule(specFor(loan, input.manualRows));
    await insertSchedule(c, userId, loan.id, rows);

    return loadLoanBundle(c, loan.id);
  });

  return json(
    { ...result, summary: summarizeLoan(result.loan, result.schedule, result.payments) },
    { status: 201 },
  );
});

guarded('PATCH', '/api/loans/:id', async ({ request, db, userId, params }) => {
  const input = loanUpdateSchema.parse(await readJson(request));
  const columns = defined({
    name: input.name,
    lender: input.lender,
    account_id: input.accountId,
    category_id: input.categoryId,
    note: input.note,
    is_closed: input.isClosed,
  });

  const row = await asUser(db, userId, async (c) => {
    const { text, values } = buildUpdate('loans', columns);
    const updated = await c.query(text, [params.id, ...values]);
    if (updated.rows.length === 0) throw notFound('Кредит не знайдено');
    return updated.rows[0]!;
  });

  return json(mapLoan(row));
});

guarded('DELETE', '/api/loans/:id', async ({ db, userId, params }) => {
  await asUser(db, userId, async (c) => {
    const deleted = await c.query(`delete from loans where id = $1 returning id`, [params.id]);
    if (deleted.rows.length === 0) throw notFound('Кредит не знайдено');
  });
  return noContent();
});

/**
 * Фіксація платежу.
 *
 * Рух грошей створюється рівно один раз — транзакцією, на яку посилається
 * loan_payments.transaction_id. Унікальні індекси в схемі не дають ані
 * закрити один рядок графіка двічі, ані прив'язати дві виплати до однієї
 * операції, тож повторне натискання кнопки не подвоїть списання.
 */
guarded('POST', '/api/loans/:id/payments', async ({ request, db, userId, params }) => {
  const input = loanPaymentSchema.parse(await readJson(request));

  const result = await asUser(db, userId, async (c) => {
    const { loan, schedule, payments } = await loadLoanBundle(c, pathParam(params, 'id'));

    const row = input.scheduleId ? schedule.find((r) => r.id === input.scheduleId) : null;
    if (input.scheduleId && !row) throw notFound('Рядок графіка не знайдено');
    if (row && row.status === 'paid') throw badRequest('Цей платіж уже позначено виконаним');

    const principalPaid = payments.reduce((s, p) => s + p.principalPart, 0);
    const outstanding = Math.max(0, loan.principal - principalPaid);
    if (outstanding === 0) throw badRequest('Кредит уже погашено');

    const allocation = allocatePayment(input.amount, row ?? null, outstanding);

    const accountId = input.accountId ?? loan.accountId;
    let transactionId: string | null = null;

    if (input.createTransaction) {
      if (!accountId) throw badRequest('Оберіть рахунок списання');
      const account = await c.query<{ currency: string }>(
        `select currency from accounts where id = $1`,
        [accountId],
      );
      if (account.rows.length === 0) throw notFound('Рахунок не знайдено');

      const inserted = await c.query<{ id: string }>(
        `insert into transactions
           (user_id, account_id, kind, amount, currency, occurred_on, status, category_id, note)
         values ($1,$2,'expense',$3,$4,$5,'posted',$6,$7) returning id`,
        [
          userId,
          accountId,
          toMoneyParam(input.amount),
          account.rows[0]!.currency,
          input.paidOn,
          loan.categoryId,
          input.note ?? `${loan.name}: платіж`,
        ],
      );
      transactionId = inserted.rows[0]!.id;
    }

    await c.query(
      `insert into loan_payments
         (user_id, loan_id, schedule_id, transaction_id, paid_on, amount,
          principal_part, interest_part, fee_part, kind, early_strategy, note)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        userId,
        loan.id,
        input.scheduleId ?? null,
        transactionId,
        input.paidOn,
        toMoneyParam(input.amount),
        toMoneyParam(allocation.principalPart),
        toMoneyParam(allocation.interestPart),
        toMoneyParam(allocation.feePart),
        input.kind,
        input.earlyStrategy ?? null,
        input.note ?? null,
      ],
    );

    if (row) {
      // Платіж, менший за очікуваний, лишає рядок відкритим як частковий.
      const covered = input.amount >= row.amount;
      await c.query(`update loan_payment_schedules set status = $2 where id = $1`, [
        row.id,
        covered ? 'paid' : 'partial',
      ]);
    }

    const newOutstanding = Math.max(0, outstanding - allocation.principalPart);

    // Дострокове погашення змінює весь хвіст графіка.
    if (input.earlyStrategy && newOutstanding > 0) {
      const future = schedule.filter((r) => r.dueOn > input.paidOn && r.status === 'pending');
      if (future.length > 0) {
        await c.query(
          `delete from loan_payment_schedules
           where loan_id = $1 and due_on > $2 and status = 'pending'`,
          [loan.id, input.paidOn],
        );

        const typical = [...schedule].sort((a, b) => a.amount - b.amount)[
          Math.floor(schedule.length / 2)
        ]!.amount;

        const tail = rebuildRemaining({
          spec: specFor(loan),
          outstanding: newOutstanding,
          nextDueOn: future[0]!.dueOn,
          remainingCount: future.length,
          currentPayment: typical,
          strategy: input.earlyStrategy,
          startSeq: future[0]!.seq,
        });
        await insertSchedule(c, userId, loan.id, tail);
      }
    }

    if (newOutstanding === 0) {
      await c.query(`update loans set is_closed = true, updated_at = now() where id = $1`, [loan.id]);
      await c.query(
        `update loan_payment_schedules set status = 'skipped'
         where loan_id = $1 and status = 'pending'`,
        [loan.id],
      );
    }

    return loadLoanBundle(c, loan.id);
  });

  return json({ ...result, summary: summarizeLoan(result.loan, result.schedule, result.payments) });
});

/** Скасування помилково внесеного платежу. */
guarded('DELETE', '/api/loans/:id/payments/:paymentId', async ({ db, userId, params }) => {
  await asUser(db, userId, async (c) => {
    const found = await c.query<{ transaction_id: string | null; schedule_id: string | null }>(
      `delete from loan_payments where id = $1 and loan_id = $2
       returning transaction_id, schedule_id`,
      [params.paymentId, params.id],
    );
    const payment = found.rows[0];
    if (!payment) throw notFound('Платіж не знайдено');

    // Разом із платежем прибираємо і рух грошей, інакше баланс «запам'ятає»
    // списання, якого більше немає в історії кредиту.
    if (payment.transaction_id) {
      await c.query(`delete from transactions where id = $1`, [payment.transaction_id]);
    }
    if (payment.schedule_id) {
      await c.query(`update loan_payment_schedules set status = 'pending' where id = $1`, [
        payment.schedule_id,
      ]);
    }
    await c.query(`update loans set is_closed = false, updated_at = now() where id = $1`, [params.id]);
  });

  return noContent();
});
