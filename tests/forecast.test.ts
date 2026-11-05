import { describe, expect, it } from 'vitest';
import {
  forecast,
  horizonRange,
  nextIncome,
  overdueEvents,
  summarize,
  upcomingPayments,
  type ForecastInput,
  type LoanDue,
} from '@core/forecast.js';
import { buildSchedule } from '@core/loans.js';
import type { RecurringRule, Transaction } from '@core/types.js';

const uah = (major: number) => Math.round(major * 100);
const TODAY = '2026-11-04';

const account = (id = 'a1', balance = uah(20_000), currency = 'UAH') => ({ id, currency, balance });

const tx = (over: Partial<Transaction> & Pick<Transaction, 'occurredOn'>): Transaction => ({
  id: `t-${Math.random().toString(36).slice(2)}`,
  kind: 'expense',
  accountId: 'a1',
  counterAccountId: null,
  counterAmount: null,
  categoryId: null,
  amount: uah(100),
  currency: 'UAH',
  status: 'posted',
  note: null,
  tags: [],
  recurringRuleId: null,
  recurringOccurrence: null,
  ...over,
});

const baseInput = (over: Partial<ForecastInput> = {}): ForecastInput => ({
  from: '2026-11-01',
  to: '2026-11-30',
  today: TODAY,
  baseCurrency: 'UAH',
  rates: { USD: 41.5, EUR: 45 },
  accounts: [account()],
  transactions: [],
  rules: [],
  exceptions: [],
  loanDues: [],
  ...over,
});

describe('опорна точка прогнозу', () => {
  it('сьогоднішній залишок дорівнює фактичному балансу, коли нічого не заплановано', () => {
    const result = forecast(baseInput());
    const today = result.byDate.get(TODAY)!;
    expect(today.closing).toBe(uah(20_000));
    expect(result.currentBalance).toBe(uah(20_000));
  });

  it('до сьогодні показує факт, відмотуючи проведені операції назад', () => {
    const result = forecast(
      baseInput({
        transactions: [
          tx({ occurredOn: '2026-11-03', kind: 'expense', amount: uah(500) }),
          tx({ occurredOn: '2026-11-02', kind: 'income', amount: uah(1000) }),
        ],
      }),
    );
    // Баланс 20 000 — це вже ПІСЛЯ обох операцій.
    expect(result.byDate.get('2026-11-03')!.closing).toBe(uah(20_000));
    expect(result.byDate.get('2026-11-02')!.closing).toBe(uah(20_500));
    expect(result.byDate.get('2026-11-01')!.closing).toBe(uah(19_500));
  });

  it('сьогодні додає лише невиконані події цього дня', () => {
    const result = forecast(
      baseInput({
        transactions: [
          // Уже проведена — вона всередині балансу 20 000.
          tx({ occurredOn: TODAY, kind: 'expense', amount: uah(300), status: 'posted' }),
          // Ще не виконана — має зменшити прогноз на кінець дня.
          tx({ occurredOn: TODAY, kind: 'expense', amount: uah(700), status: 'planned' }),
        ],
      }),
    );
    expect(result.byDate.get(TODAY)!.closing).toBe(uah(19_300));
  });

  it('проведена операція з майбутньою датою не враховується двічі', () => {
    const result = forecast(
      baseInput({
        transactions: [tx({ occurredOn: '2026-11-20', kind: 'expense', amount: uah(2000), status: 'posted' })],
      }),
    );
    // Баланс 20 000 уже містить це списання, тож «сьогодні» має бути 22 000,
    // а 20 листопада — знову 20 000.
    expect(result.byDate.get(TODAY)!.closing).toBe(uah(22_000));
    expect(result.byDate.get('2026-11-20')!.closing).toBe(uah(20_000));
    expect(result.byDate.get('2026-11-30')!.closing).toBe(uah(20_000));
  });
});

describe('регулярні операції у прогнозі', () => {
  const salary: RecurringRule = {
    id: 'salary', kind: 'income', accountId: 'a1', counterAccountId: null, categoryId: null,
    amount: uah(40_000), currency: 'UAH', note: 'Зарплата', freq: 'monthly', step: 1,
    anchorDate: '2026-11-10', endDate: null, maxOccurrences: null, monthEndPolicy: 'clamp',
    autoPost: false, isActive: true,
  };

  it('майбутнє надходження піднімає прогноз із дати нарахування', () => {
    const result = forecast(baseInput({ rules: [salary] }));
    expect(result.byDate.get('2026-11-09')!.closing).toBe(uah(20_000));
    expect(result.byDate.get('2026-11-10')!.closing).toBe(uah(60_000));
  });

  it('матеріалізоване повторення не рахується двічі', () => {
    const result = forecast(
      baseInput({
        rules: [salary],
        transactions: [
          tx({
            occurredOn: '2026-11-10',
            kind: 'income',
            amount: uah(40_000),
            status: 'posted',
            recurringRuleId: 'salary',
            recurringOccurrence: '2026-11-10',
          }),
        ],
      }),
    );
    // Операція вже у балансі: 10 листопада прогноз має лишитися 20 000,
    // а не 60 000 і не 100 000.
    expect(result.byDate.get('2026-11-10')!.closing).toBe(uah(20_000));
    const events = result.byDate.get('2026-11-10')!.events;
    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe('transaction');
  });

  it('прострочене повторення не знімає грошей, але позначається', () => {
    const rent: RecurringRule = { ...salary, id: 'rent', kind: 'expense', amount: uah(15_000), anchorDate: '2026-11-01', note: 'Оренда' };
    const result = forecast(baseInput({ rules: [rent] }));

    // 1 листопада — минуле, факт не змінився.
    expect(result.byDate.get('2026-11-01')!.closing).toBe(uah(20_000));
    const overdue = overdueEvents(result);
    expect(overdue).toHaveLength(1);
    expect(overdue[0]!.title).toBe('Оренда');
  });
});

describe('кредитні платежі', () => {
  const due = (over: Partial<LoanDue> & Pick<LoanDue, 'id' | 'dueOn' | 'amount'>): LoanDue => ({
    loanId: 'l1', loanName: 'Розстрочка', currency: 'UAH', accountId: 'a1',
    categoryId: null, status: 'pending', ...over,
  });

  it('несплачений рядок графіка зменшує прогноз', () => {
    const result = forecast(
      baseInput({ loanDues: [due({ id: 's1', dueOn: '2026-11-15', amount: uah(3000) })] }),
    );
    expect(result.byDate.get('2026-11-15')!.closing).toBe(uah(17_000));
    expect(result.byDate.get('2026-11-15')!.loanPayments).toBe(uah(3000));
  });

  it('сплачений платіж не віднімається вдруге', () => {
    // Ключова вимога ТЗ: борговий платіж, уже представлений транзакцією
    // списання, не можна віднімати ще раз як рядок графіка.
    const result = forecast(
      baseInput({
        loanDues: [due({ id: 's1', dueOn: '2026-11-15', amount: uah(3000), status: 'paid' })],
        transactions: [
          tx({ occurredOn: '2026-11-15', kind: 'expense', amount: uah(3000), status: 'posted' }),
        ],
      }),
    );
    // Транзакція вже у балансі 20 000 → прогноз лишається 20 000.
    expect(result.byDate.get('2026-11-15')!.closing).toBe(uah(20_000));
    expect(result.byDate.get('2026-11-15')!.loanPayments).toBe(0);
  });
});

describe('дефіцит', () => {
  it('позначає дні, коли грошей не вистачає', () => {
    const result = forecast(
      baseInput({
        accounts: [account('a1', uah(5000))],
        loanDues: [
          { id: 's1', loanId: 'l1', loanName: 'Кредит', currency: 'UAH', accountId: 'a1',
            categoryId: null, status: 'pending', dueOn: '2026-11-20', amount: uah(8000) },
        ],
      }),
    );

    const summary = summarize(result);
    expect(summary.deficitDates).toContain('2026-11-20');
    expect(summary.minBalance).toBe(uah(-3000));
    expect(summary.minBalanceDate).toBe('2026-11-20');
    expect(result.byDate.get('2026-11-20')!.hasDeficit).toBe(true);
    expect(result.byDate.get('2026-11-19')!.hasDeficit).toBe(false);
  });
});

describe('мультивалютність', () => {
  it('зводить рахунки в базову валюту за курсом', () => {
    const result = forecast(
      baseInput({ accounts: [account('a1', uah(10_000)), account('a2', uah(1000), 'USD')] }),
    );
    // 10 000 ₴ + 1000 $ × 41.5 = 51 500 ₴
    expect(result.currentBalance).toBe(uah(51_500));
    expect(result.missingRates).toEqual([]);
  });

  it('повідомляє про відсутній курс замість хибного підсумку', () => {
    const result = forecast(
      baseInput({ rates: {}, accounts: [account('a1', uah(10_000)), account('a2', uah(1000), 'USD')] }),
    );
    expect(result.missingRates).toContain('USD');
    expect(result.currentBalance).toBe(uah(10_000));
  });

  it('переказ між своїми рахунками не змінює капітал', () => {
    const result = forecast(
      baseInput({
        accounts: [account('a1', uah(10_000)), account('a2', uah(5000))],
        transactions: [
          tx({ occurredOn: '2026-11-20', kind: 'transfer', amount: uah(2000),
               accountId: 'a1', counterAccountId: 'a2', status: 'planned' }),
        ],
      }),
    );
    expect(result.byDate.get('2026-11-20')!.closing).toBe(uah(15_000));
  });

  it('фільтр по рахунку враховує лише його сторону переказу', () => {
    const input = baseInput({
      accounts: [account('a1', uah(10_000)), account('a2', uah(5000))],
      transactions: [
        tx({ occurredOn: '2026-11-20', kind: 'transfer', amount: uah(2000),
             accountId: 'a1', counterAccountId: 'a2', status: 'planned' }),
      ],
      accountId: 'a1',
    });
    const result = forecast(input);
    expect(result.currentBalance).toBe(uah(10_000));
    expect(result.byDate.get('2026-11-20')!.closing).toBe(uah(8000));
  });
});

describe('горизонти та підсумки', () => {
  it('рахує прогноз на 12 місяців', () => {
    const { from, to } = horizonRange(TODAY, '12m');
    const salary: RecurringRule = {
      id: 'salary', kind: 'income', accountId: 'a1', counterAccountId: null, categoryId: null,
      amount: uah(40_000), currency: 'UAH', note: 'Зарплата', freq: 'monthly', step: 1,
      anchorDate: '2026-11-10', endDate: null, maxOccurrences: null, monthEndPolicy: 'clamp',
      autoPost: false, isActive: true,
    };
    const rent: RecurringRule = { ...salary, id: 'rent', kind: 'expense', amount: uah(15_000), anchorDate: '2026-11-05', note: 'Оренда' };

    const result = forecast(baseInput({ from, to, rules: [salary, rent] }));
    const summary = summarize(result);

    expect(result.days).toHaveLength(366);
    // 12 зарплат і 12 оренд попереду (5 листопада вже минуло).
    expect(summary.income).toBe(uah(40_000 * 12));
    expect(summary.expense).toBe(uah(15_000 * 12));
    expect(summary.closingBalance).toBe(uah(20_000 + (40_000 - 15_000) * 12));
    expect(summary.savingsRate).toBeCloseTo(62.5, 1);
  });

  it('показує найбільші витрати періоду', () => {
    const result = forecast(
      baseInput({
        transactions: [
          tx({ occurredOn: '2026-11-20', amount: uah(500), status: 'planned', note: 'Мала' }),
          tx({ occurredOn: '2026-11-21', amount: uah(9000), status: 'planned', note: 'Велика' }),
          tx({ occurredOn: '2026-11-22', amount: uah(3000), status: 'planned', note: 'Середня' }),
        ],
      }),
    );
    const summary = summarize(result);
    expect(summary.biggestExpenses.map((e) => e.title)).toEqual(['Велика', 'Середня', 'Мала']);
  });
});

describe('довідки головного екрана', () => {
  it('відповідає, чи вистачить грошей до наступної зарплати', () => {
    const salary: RecurringRule = {
      id: 'salary', kind: 'income', accountId: 'a1', counterAccountId: null, categoryId: null,
      amount: uah(40_000), currency: 'UAH', note: 'Зарплата', freq: 'monthly', step: 1,
      anchorDate: '2026-11-12', endDate: null, maxOccurrences: null, monthEndPolicy: 'clamp',
      autoPost: false, isActive: true,
    };
    const result = forecast(
      baseInput({
        accounts: [account('a1', uah(11_800))],
        rules: [salary],
        loanDues: [
          { id: 's1', loanId: 'l1', loanName: 'Розстрочка', currency: 'UAH', accountId: 'a1',
            categoryId: null, status: 'pending', dueOn: '2026-11-08', amount: uah(9500) },
        ],
      }),
    );

    const info = nextIncome(result, TODAY)!;
    expect(info.date).toBe('2026-11-12');
    expect(info.daysUntil).toBe(8);
    expect(info.plannedOutflow).toBe(uah(9500));
    expect(info.balanceBefore).toBe(uah(2300));
    expect(info.willHoldOut).toBe(true);
  });

  it('попереджає, коли до зарплати грошей не вистачить', () => {
    const salary: RecurringRule = {
      id: 'salary', kind: 'income', accountId: 'a1', counterAccountId: null, categoryId: null,
      amount: uah(40_000), currency: 'UAH', note: 'Зарплата', freq: 'monthly', step: 1,
      anchorDate: '2026-11-12', endDate: null, maxOccurrences: null, monthEndPolicy: 'clamp',
      autoPost: false, isActive: true,
    };
    const result = forecast(
      baseInput({
        accounts: [account('a1', uah(5000))],
        rules: [salary],
        loanDues: [
          { id: 's1', loanId: 'l1', loanName: 'Розстрочка', currency: 'UAH', accountId: 'a1',
            categoryId: null, status: 'pending', dueOn: '2026-11-08', amount: uah(9500) },
        ],
      }),
    );
    expect(nextIncome(result, TODAY)!.willHoldOut).toBe(false);
  });

  it('перелічує найближчі обов’язкові платежі', () => {
    const result = forecast(
      baseInput({
        loanDues: [
          { id: 's1', loanId: 'l1', loanName: 'Розстрочка', currency: 'UAH', accountId: 'a1',
            categoryId: null, status: 'pending', dueOn: '2026-11-15', amount: uah(3000) },
        ],
        transactions: [tx({ occurredOn: '2026-11-08', amount: uah(900), status: 'planned', note: 'Інтернет' })],
      }),
    );
    const upcoming = upcomingPayments(result, TODAY);
    expect(upcoming.map((e) => e.title)).toEqual(['Інтернет', 'Розстрочка']);
  });
});

describe('сценарій «а що, якщо»', () => {
  it('перераховує залишки без створення транзакції', () => {
    const input = baseInput({ accounts: [account('a1', uah(30_000))] });
    const before = forecast(input);
    const after = forecast({
      ...input,
      scenarios: [
        { date: '2026-11-15', amount: uah(8000), currency: 'UAH', kind: 'expense', title: 'Техніка' },
      ],
    });

    expect(before.byDate.get('2026-11-30')!.closing).toBe(uah(30_000));
    expect(after.byDate.get('2026-11-14')!.closing).toBe(uah(30_000));
    expect(after.byDate.get('2026-11-15')!.closing).toBe(uah(22_000));
    expect(after.byDate.get('2026-11-30')!.closing).toBe(uah(22_000));
    // Вхідні дані не змінилися — сценарій нічого не зберіг.
    expect(input.transactions).toHaveLength(0);
  });
});

describe('сценарій приймання з ТЗ', () => {
  it('рахунок 20 000, зарплата 40 000 десятого, оренда 15 000 п’ятого, розстрочка 24 000 на 8 місяців', () => {
    const salary: RecurringRule = {
      id: 'salary', kind: 'income', accountId: 'a1', counterAccountId: null, categoryId: null,
      amount: uah(40_000), currency: 'UAH', note: 'Зарплата', freq: 'monthly', step: 1,
      anchorDate: '2026-11-10', endDate: null, maxOccurrences: null, monthEndPolicy: 'clamp',
      autoPost: false, isActive: true,
    };
    const rent: RecurringRule = {
      ...salary, id: 'rent', kind: 'expense', amount: uah(15_000),
      anchorDate: '2026-12-05', note: 'Оренда',
    };

    const schedule = buildSchedule({
      principal: uah(24_000), rateAnnual: null, scheduleType: 'interest_free',
      paymentsCount: 8, firstPaymentOn: '2026-12-01',
    });
    expect(schedule.every((r) => r.amount === uah(3000))).toBe(true);

    const loanDues: LoanDue[] = schedule.map((row, i) => ({
      id: `s${i}`, loanId: 'l1', loanName: 'Розстрочка', currency: 'UAH',
      accountId: 'a1', categoryId: null, status: row.status,
      dueOn: row.dueOn, amount: row.amount,
    }));

    const result = forecast(
      baseInput({ from: TODAY, to: '2027-07-31', rules: [salary, rent], loanDues }),
    );

    // Сьогодні — рівно фактичний залишок.
    expect(result.byDate.get(TODAY)!.closing).toBe(uah(20_000));
    // 10 листопада приходить зарплата.
    expect(result.byDate.get('2026-11-10')!.closing).toBe(uah(60_000));
    // 1 грудня — перший платіж розстрочки.
    expect(result.byDate.get('2026-12-01')!.closing).toBe(uah(57_000));
    // 5 грудня — оренда.
    expect(result.byDate.get('2026-12-05')!.closing).toBe(uah(42_000));
    // 10 грудня — друга зарплата.
    expect(result.byDate.get('2026-12-10')!.closing).toBe(uah(82_000));

    // Остання виплата розстрочки — 1 липня 2027.
    const lastLoanDay = result.byDate.get('2027-07-01')!;
    expect(lastLoanDay.loanPayments).toBe(uah(3000));
    expect(result.days.filter((d) => d.loanPayments > 0)).toHaveLength(8);

    // Дефіциту немає: доходи перекривають усі зобов'язання.
    expect(summarize(result).deficitDates).toEqual([]);
  });
});
