import { randomUUID } from 'node:crypto';
import { asUser } from '../db/types.ts';
import { json, readJson } from '../http.ts';
import { importSchema } from '../schemas.ts';
import { guarded } from '../router.ts';

/**
 * Імпорт резервної копії.
 *
 * Ключова складність: первинні ключі глобально унікальні, а копія могла
 * бути знята з іншого облікового запису. Спроба вставити рядки з їхніми
 * рідними id мовчки провалюється конфліктом із чужими записами. Тому
 * імпорт ПЕРЕНУМЕРОВУЄ ідентифікатори й переписує всі посилання.
 *
 * Дублікати шукаються за змістом, а не за id:
 *   - рахунок    — за назвою та валютою;
 *   - категорія  — за назвою, типом і батьком;
 *   - операція   — за датою, типом, сумою, рахунком і приміткою;
 *   - кредит     — за назвою, тілом і датою оформлення.
 *
 * Завдяки цьому повторний імпорт того самого файлу нічого не подвоює, а
 * копія з іншого акаунта акуратно доливається до наявних даних.
 */

type Row = Record<string, unknown>;

const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

/**
 * Нормалізує дату до 'YYYY-MM-DD'.
 *
 * Драйвери віддають DATE по-різному: node-postgres (з нашим парсером) —
 * рядком, PGlite — об'єктом Date. Наївний String(value).slice(0,10) дав би
 * для Date «Sat Nov 02» і зламав би пошук дублікатів.
 */
const dateOnly = (value: unknown): string => {
  if (value instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${value.getUTCFullYear()}-${p(value.getUTCMonth() + 1)}-${p(value.getUTCDate())}`;
  }
  return text(value).slice(0, 10);
};

interface ImportReport {
  mode: 'preview' | 'apply';
  applied: boolean;
  willAdd: Record<string, number>;
  duplicates: Record<string, number>;
  /** Рядки, чиї посилання не вдалося відновити. */
  skipped: { transactions: number; recurringRules: number; loans: number };
  warnings: string[];
}

guarded('POST', '/api/import', async ({ request, db, userId }) => {
  const { mode, payload } = importSchema.parse(await readJson(request));

  const report = await asUser(db, userId, async (c) => {
    const accountMap = new Map<string, string>();
    const categoryMap = new Map<string, string>();
    const transactionMap = new Map<string, string>();

    const apply = mode === 'apply';
    const warnings: string[] = [];
    const added = { accounts: 0, categories: 0, transactions: 0, recurringRules: 0, loans: 0 };
    const dupes = { accounts: 0, categories: 0, transactions: 0, recurringRules: 0, loans: 0 };
    const skipped = { transactions: 0, recurringRules: 0, loans: 0 };

    // ── Рахунки ──
    const existingAccounts = await c.query<{ id: string; name: string; currency: string }>(
      `select id, name, currency from accounts`,
    );
    const accountByKey = new Map(
      existingAccounts.rows.map((r) => [`${r.name.toLowerCase()}|${r.currency}`, r.id]),
    );

    for (const row of payload.accounts as Row[]) {
      const key = `${text(row.name).toLowerCase()}|${text(row.currency)}`;
      const existing = accountByKey.get(key);
      if (existing) {
        accountMap.set(text(row.id), existing);
        dupes.accounts += 1;
        continue;
      }

      const id = randomUUID();
      accountMap.set(text(row.id), id);
      accountByKey.set(key, id);
      added.accounts += 1;

      if (apply) {
        await c.query(
          `insert into accounts (id, user_id, name, type, currency, initial_balance, color, icon,
                                 is_archived, sort_order)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            id, userId, text(row.name) || 'Імпортований рахунок', text(row.type) || 'other',
            text(row.currency) || 'UAH', text(row.initial_balance) || '0',
            text(row.color) || '#2f6bff', text(row.icon) || 'Wallet',
            row.is_archived === true, Number(row.sort_order ?? 0),
          ],
        );
      }
    }

    // ── Категорії: спершу батьківські, щоб було на що посилатися ──
    const existingCategories = await c.query<{
      id: string; name: string; kind: string; parent_id: string | null;
    }>(`select id, name, kind, parent_id from categories`);
    const categoryKey = (name: string, kind: string, parent: string | null) =>
      `${name.toLowerCase()}|${kind}|${parent ?? ''}`;
    const categoryByKey = new Map(
      existingCategories.rows.map((r) => [categoryKey(r.name, r.kind, r.parent_id), r.id]),
    );

    const incomingCategories = [...(payload.categories as Row[])].sort(
      (a, b) => Number(Boolean(a.parent_id)) - Number(Boolean(b.parent_id)),
    );

    for (const row of incomingCategories) {
      const parentOld = row.parent_id ? text(row.parent_id) : null;
      const parentNew = parentOld ? (categoryMap.get(parentOld) ?? null) : null;
      if (parentOld && !parentNew) {
        // Батька не імпортували — робимо категорію кореневою, щоб не загубити її.
        warnings.push(`Категорія «${text(row.name)}» втратила батьківську і стала кореневою`);
      }

      const key = categoryKey(text(row.name), text(row.kind), parentNew);
      const existing = categoryByKey.get(key);
      if (existing) {
        categoryMap.set(text(row.id), existing);
        dupes.categories += 1;
        continue;
      }

      const id = randomUUID();
      categoryMap.set(text(row.id), id);
      categoryByKey.set(key, id);
      added.categories += 1;

      if (apply) {
        await c.query(
          `insert into categories (id, user_id, name, kind, parent_id, icon, color, is_archived, sort_order)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id, userId, text(row.name) || 'Без назви', text(row.kind) || 'expense', parentNew,
            text(row.icon) || 'Circle', text(row.color) || '#8b8f9a',
            row.is_archived === true, Number(row.sort_order ?? 0),
          ],
        );
      }
    }

    // ── Операції ──
    const existingTransactions = await c.query<{
      account_id: string; occurred_on: string; kind: string; amount: string; note: string | null;
    }>(`select account_id, occurred_on, kind, amount, note from transactions`);
    const txKey = (account: string, on: string, kind: string, amount: string, note: string) =>
      `${account}|${on}|${kind}|${Number(amount).toFixed(2)}|${note}`;
    const txSeen = new Set(
      existingTransactions.rows.map((r) =>
        txKey(r.account_id, dateOnly(r.occurred_on), r.kind, r.amount, text(r.note)),
      ),
    );

    for (const row of payload.transactions as Row[]) {
      const accountId = accountMap.get(text(row.account_id));
      if (!accountId) {
        skipped.transactions += 1;
        continue;
      }

      const key = txKey(
        accountId, dateOnly(row.occurred_on), text(row.kind), text(row.amount), text(row.note),
      );
      if (txSeen.has(key)) {
        dupes.transactions += 1;
        continue;
      }
      txSeen.add(key);

      const id = randomUUID();
      transactionMap.set(text(row.id), id);
      added.transactions += 1;

      if (apply) {
        const counter = row.counter_account_id ? accountMap.get(text(row.counter_account_id)) : null;
        const kind = text(row.kind) || 'expense';
        // Переказ без відновленого рахунку призначення перестає бути переказом.
        const safeKind = kind === 'transfer' && !counter ? 'expense' : kind;

        await c.query(
          `insert into transactions (id, user_id, account_id, kind, amount, currency, occurred_on,
                                     status, category_id, counter_account_id, counter_amount, note, tags)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            id, userId, accountId, safeKind, text(row.amount) || '0',
            text(row.currency) || 'UAH', dateOnly(row.occurred_on),
            text(row.status) || 'posted',
            safeKind === 'transfer' ? null : (row.category_id ? categoryMap.get(text(row.category_id)) ?? null : null),
            safeKind === 'transfer' ? counter : null,
            safeKind === 'transfer' && row.counter_amount ? text(row.counter_amount) : null,
            row.note === null || row.note === undefined ? null : text(row.note),
            Array.isArray(row.tags) ? row.tags : [],
          ],
        );
      }
    }

    // ── Регулярні правила ──
    const existingRules = await c.query<{
      kind: string; account_id: string; amount: string; freq: string; anchor_date: string;
    }>(`select kind, account_id, amount, freq, anchor_date from recurring_rules`);
    const ruleKey = (kind: string, account: string, amount: string, freq: string, anchor: string) =>
      `${kind}|${account}|${Number(amount).toFixed(2)}|${freq}|${anchor}`;
    const ruleSeen = new Set(
      existingRules.rows.map((r) =>
        ruleKey(r.kind, r.account_id, r.amount, r.freq, dateOnly(r.anchor_date)),
      ),
    );

    for (const row of payload.recurringRules as Row[]) {
      const accountId = accountMap.get(text(row.account_id));
      if (!accountId) {
        skipped.recurringRules += 1;
        continue;
      }

      const key = ruleKey(
        text(row.kind), accountId, text(row.amount), text(row.freq), dateOnly(row.anchor_date),
      );
      if (ruleSeen.has(key)) {
        dupes.recurringRules += 1;
        continue;
      }
      ruleSeen.add(key);
      added.recurringRules += 1;

      if (apply) {
        const counter = row.counter_account_id ? accountMap.get(text(row.counter_account_id)) : null;
        const kind = text(row.kind) || 'expense';
        if (kind === 'transfer' && !counter) {
          warnings.push(`Регулярний переказ «${text(row.note)}» пропущено: немає рахунку призначення`);
          added.recurringRules -= 1;
          skipped.recurringRules += 1;
          continue;
        }

        await c.query(
          `insert into recurring_rules (id, user_id, kind, account_id, counter_account_id, category_id,
                                        amount, currency, note, freq, step, anchor_date, end_date,
                                        max_occurrences, month_end_policy, auto_post, is_active)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            randomUUID(), userId, kind, accountId, kind === 'transfer' ? counter : null,
            kind === 'transfer' ? null : (row.category_id ? categoryMap.get(text(row.category_id)) ?? null : null),
            text(row.amount) || '0', text(row.currency) || 'UAH',
            row.note === null || row.note === undefined ? null : text(row.note),
            text(row.freq) || 'monthly', Number(row.step ?? 1), dateOnly(row.anchor_date),
            row.end_date ? dateOnly(row.end_date) : null,
            row.max_occurrences === null || row.max_occurrences === undefined ? null : Number(row.max_occurrences),
            text(row.month_end_policy) || 'clamp', row.auto_post === true, row.is_active !== false,
          ],
        );
      }
    }

    // ── Кредити з графіками та виплатами ──
    const existingLoans = await c.query<{ name: string; principal: string; opened_on: string }>(
      `select name, principal, opened_on from loans`,
    );
    const loanKey = (name: string, principal: string, opened: string) =>
      `${name.toLowerCase()}|${Number(principal).toFixed(2)}|${opened}`;
    const loanSeen = new Set(
      existingLoans.rows.map((r) => loanKey(r.name, r.principal, dateOnly(r.opened_on))),
    );

    const schedulesByLoan = new Map<string, Row[]>();
    for (const row of payload.loanSchedules as Row[]) {
      const loanId = text(row.loan_id);
      schedulesByLoan.set(loanId, [...(schedulesByLoan.get(loanId) ?? []), row]);
    }
    const paymentsByLoan = new Map<string, Row[]>();
    for (const row of payload.loanPayments as Row[]) {
      const loanId = text(row.loan_id);
      paymentsByLoan.set(loanId, [...(paymentsByLoan.get(loanId) ?? []), row]);
    }

    for (const row of payload.loans as Row[]) {
      const key = loanKey(text(row.name), text(row.principal), dateOnly(row.opened_on));
      if (loanSeen.has(key)) {
        dupes.loans += 1;
        continue;
      }
      loanSeen.add(key);
      added.loans += 1;
      if (!apply) continue;

      const loanId = randomUUID();
      await c.query(
        `insert into loans (id, user_id, name, lender, kind, principal, currency, opened_on,
                            term_months, rate_input, rate_period, rate_annual, schedule_type,
                            payment_day, first_payment_on, payments_count, total_due,
                            fee_fixed, fee_percent, account_id, category_id, note, is_closed)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [
          loanId, userId, text(row.name) || 'Імпортований кредит',
          row.lender ? text(row.lender) : null, text(row.kind) || 'loan',
          text(row.principal) || '0', text(row.currency) || 'UAH', dateOnly(row.opened_on),
          row.term_months === null || row.term_months === undefined ? null : Number(row.term_months),
          row.rate_input === null || row.rate_input === undefined ? null : Number(row.rate_input),
          row.rate_period ? text(row.rate_period) : null,
          row.rate_annual === null || row.rate_annual === undefined ? null : Number(row.rate_annual),
          text(row.schedule_type) || 'interest_free',
          row.payment_day === null || row.payment_day === undefined ? null : Number(row.payment_day),
          dateOnly(row.first_payment_on),
          row.payments_count === null || row.payments_count === undefined ? null : Number(row.payments_count),
          row.total_due === null || row.total_due === undefined ? null : text(row.total_due),
          text(row.fee_fixed) || '0', Number(row.fee_percent ?? 0),
          row.account_id ? accountMap.get(text(row.account_id)) ?? null : null,
          row.category_id ? categoryMap.get(text(row.category_id)) ?? null : null,
          row.note ? text(row.note) : null, row.is_closed === true,
        ],
      );

      const scheduleMap = new Map<string, string>();
      for (const sched of schedulesByLoan.get(text(row.id)) ?? []) {
        const schedId = randomUUID();
        scheduleMap.set(text(sched.id), schedId);
        await c.query(
          `insert into loan_payment_schedules (id, user_id, loan_id, seq, due_on, amount,
                                               principal_part, interest_part, fee_part,
                                               balance_after, status)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            schedId, userId, loanId, Number(sched.seq ?? 1), dateOnly(sched.due_on),
            text(sched.amount) || '0', text(sched.principal_part) || '0',
            text(sched.interest_part) || '0', text(sched.fee_part) || '0',
            text(sched.balance_after) || '0', text(sched.status) || 'pending',
          ],
        );
      }

      for (const pay of paymentsByLoan.get(text(row.id)) ?? []) {
        await c.query(
          `insert into loan_payments (id, user_id, loan_id, schedule_id, transaction_id, paid_on,
                                      amount, principal_part, interest_part, fee_part, kind,
                                      early_strategy, note)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            randomUUID(), userId, loanId,
            pay.schedule_id ? scheduleMap.get(text(pay.schedule_id)) ?? null : null,
            pay.transaction_id ? transactionMap.get(text(pay.transaction_id)) ?? null : null,
            dateOnly(pay.paid_on), text(pay.amount) || '0',
            text(pay.principal_part) || '0', text(pay.interest_part) || '0',
            text(pay.fee_part) || '0', text(pay.kind) || 'scheduled',
            pay.early_strategy ? text(pay.early_strategy) : null,
            pay.note ? text(pay.note) : null,
          ],
        );
      }
    }

    // ── Курси валют ──
    for (const rate of payload.exchangeRates as Row[]) {
      if (!apply) continue;
      if (text(rate.base) === text(rate.quote)) continue;
      await c.query(
        `insert into exchange_rates (user_id, base, quote, rate) values ($1,$2,$3,$4)
         on conflict (user_id, base, quote) do update set rate = excluded.rate, updated_at = now()`,
        [userId, text(rate.base), text(rate.quote), Number(rate.rate ?? 1)],
      );
    }

    const result: ImportReport = {
      mode,
      applied: apply,
      willAdd: added,
      duplicates: dupes,
      skipped,
      warnings: [...new Set(warnings)].slice(0, 20),
    };
    return result;
  });

  return json(report);
});
