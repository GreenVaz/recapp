import { describe, expect, it } from 'vitest';
import { expandRule, expandRules, nextOccurrence } from '@core/recurrence.js';
import type { RecurringException, RecurringRule } from '@core/types.js';

const rule = (over: Partial<RecurringRule> = {}): RecurringRule => ({
  id: 'r1',
  kind: 'expense',
  accountId: 'a1',
  counterAccountId: null,
  categoryId: null,
  amount: 1_500_000,
  currency: 'UAH',
  note: 'Оренда',
  freq: 'monthly',
  step: 1,
  anchorDate: '2026-11-05',
  endDate: null,
  maxOccurrences: null,
  monthEndPolicy: 'clamp',
  autoPost: false,
  isActive: true,
  ...over,
});

describe('розгортання регулярних правил', () => {
  it('щомісяця від якоря', () => {
    const dates = expandRule(rule(), '2026-11-01', '2027-02-28').map((o) => o.date);
    expect(dates).toEqual(['2026-11-05', '2026-12-05', '2027-01-05', '2027-02-05']);
  });

  it('31 число не з’їжджає після лютого', () => {
    const dates = expandRule(rule({ anchorDate: '2026-12-31' }), '2026-12-01', '2027-05-31').map(
      (o) => o.date,
    );
    expect(dates).toEqual(['2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
  });

  it('політика skip пропускає короткі місяці', () => {
    const dates = expandRule(
      rule({ anchorDate: '2026-12-31', monthEndPolicy: 'skip' }),
      '2026-12-01',
      '2027-04-30',
    ).map((o) => o.date);
    expect(dates).toEqual(['2026-12-31', '2027-01-31', '2027-03-31']);
  });

  it('щотижня і щодня з кроком', () => {
    const weekly = expandRule(
      rule({ freq: 'weekly', anchorDate: '2026-11-02' }),
      '2026-11-01',
      '2026-11-30',
    ).map((o) => o.date);
    expect(weekly).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);

    const everyOther = expandRule(
      rule({ freq: 'daily', step: 3, anchorDate: '2026-11-01' }),
      '2026-11-01',
      '2026-11-10',
    ).map((o) => o.date);
    expect(everyOther).toEqual(['2026-11-01', '2026-11-04', '2026-11-07', '2026-11-10']);
  });

  it('поважає кінець серії та ліміт повторень', () => {
    expect(expandRule(rule({ endDate: '2027-01-01' }), '2026-11-01', '2027-06-01')).toHaveLength(2);
    expect(expandRule(rule({ maxOccurrences: 3 }), '2026-11-01', '2027-06-01')).toHaveLength(3);
  });

  it('неактивне правило не дає подій', () => {
    expect(expandRule(rule({ isActive: false }), '2026-11-01', '2027-06-01')).toEqual([]);
  });

  it('високосний рік для щорічного правила', () => {
    const dates = expandRule(
      rule({ freq: 'yearly', anchorDate: '2028-02-29' }),
      '2028-01-01',
      '2032-12-31',
    ).map((o) => o.date);
    expect(dates).toEqual(['2028-02-29', '2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']);
  });
});

describe('винятки серії', () => {
  const exceptions = (list: Partial<RecurringException>[]): RecurringException[] =>
    list.map((e) => ({
      ruleId: 'r1',
      occurrenceDate: '2026-12-05',
      action: 'skip',
      newDate: null,
      newAmount: null,
      newNote: null,
      ...e,
    }));

  it('skip прибирає одне повторення, не чіпаючи решту', () => {
    const dates = expandRule(rule(), '2026-11-01', '2027-02-28', exceptions([{ action: 'skip' }])).map(
      (o) => o.date,
    );
    expect(dates).toEqual(['2026-11-05', '2027-01-05', '2027-02-05']);
  });

  it('move переносить дату, але повторення лишається тим самим', () => {
    const occurrences = expandRule(
      rule(),
      '2026-11-01',
      '2027-01-31',
      exceptions([{ action: 'move', newDate: '2026-12-12' }]),
    );
    const moved = occurrences.find((o) => o.occurrenceDate === '2026-12-05');
    expect(moved?.date).toBe('2026-12-12');
    expect(moved?.moved).toBe(true);
    // Задвоєння немає: 5 грудня події вже не існує.
    expect(occurrences.filter((o) => o.date === '2026-12-05')).toHaveLength(0);
    expect(occurrences).toHaveLength(3);
  });

  it('override змінює суму лише цього разу', () => {
    const occurrences = expandRule(
      rule(),
      '2026-11-01',
      '2027-01-31',
      exceptions([{ action: 'override', newAmount: 1_700_000, newNote: 'Підвищили оренду' }]),
    );
    expect(occurrences.find((o) => o.occurrenceDate === '2026-12-05')?.amount).toBe(1_700_000);
    expect(occurrences.find((o) => o.occurrenceDate === '2026-11-05')?.amount).toBe(1_500_000);
  });
});

describe('наступне повторення', () => {
  it('знаходить найближчу майбутню дату', () => {
    expect(nextOccurrence(rule(), '2026-11-05')?.date).toBe('2026-12-05');
    expect(nextOccurrence(rule(), '2026-12-31')?.date).toBe('2027-01-05');
  });

  it('повертає null для завершеної серії', () => {
    expect(nextOccurrence(rule({ endDate: '2026-11-30' }), '2026-12-01')).toBeNull();
  });
});

describe('кілька правил разом', () => {
  it('повертає події, відсортовані за датою', () => {
    const salary = rule({ id: 'r2', kind: 'income', amount: 4_000_000, anchorDate: '2026-11-10' });
    const dates = expandRules([rule(), salary], '2026-11-01', '2026-12-31').map((o) => o.date);
    expect(dates).toEqual(['2026-11-05', '2026-11-10', '2026-12-05', '2026-12-10']);
  });
});
