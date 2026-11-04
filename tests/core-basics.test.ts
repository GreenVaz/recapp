import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  addYears,
  daysInMonth,
  diffDays,
  eachDay,
  endOfMonth,
  isLeapYear,
  monthGrid,
  startOfWeek,
  today,
} from '@core/dates.ts';
import {
  formatMoney,
  fromMajor,
  parseNumeric,
  percentOf,
  splitEvenly,
  sumInBase,
  toBase,
  toNumeric,
} from '@core/money.ts';

describe('дати', () => {
  it('знає довжину місяців і високосні роки', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29); // ділиться на 400
    expect(daysInMonth(1900, 2)).toBe(28); // ділиться на 100, але не на 400
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2026)).toBe(false);
  });

  it('обрізає 31 число до останнього дня коротшого місяця', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
  });

  it('пропускає місяць за політикою skip', () => {
    expect(addMonths('2026-01-31', 1, 'skip')).toBeNull();
    expect(addMonths('2026-01-31', 2, 'skip')).toBe('2026-03-31');
  });

  it('не дає серії з’їхати: кожен крок рахується від якоря', () => {
    const anchor = '2026-01-31';
    const series = [0, 1, 2, 3, 4].map((n) => addMonths(anchor, n));
    expect(series).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('29 лютого у високосному році переходить у 28 лютого у звичайному', () => {
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28');
    expect(addYears('2028-02-29', 4)).toBe('2032-02-29');
  });

  it('рахує різницю днів через межу місяця і року', () => {
    expect(diffDays('2026-12-31', '2027-01-01')).toBe(1);
    expect(diffDays('2026-02-28', '2026-03-01')).toBe(1);
    expect(diffDays('2028-02-28', '2028-03-01')).toBe(2); // високосний
    expect(diffDays('2026-11-04', '2026-11-04')).toBe(0);
  });

  it('не залежить від часового поясу', () => {
    // Дата як рядок не має часу, тож перехід на літній час нічого не зсуває.
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
  });

  it('повертає сьогоднішню дату в локальному поясі', () => {
    expect(today(new Date(2026, 10, 4, 23, 30))).toBe('2026-11-04');
    expect(today(new Date(2026, 0, 1, 0, 1))).toBe('2026-01-01');
  });

  it('будує сітку місяця з цілих тижнів', () => {
    const grid = monthGrid('2026-11-15', 1);
    expect(grid.length % 7).toBe(0);
    expect(grid).toContain('2026-11-01');
    expect(grid).toContain('2026-11-30');
    expect(startOfWeek('2026-11-04', 1)).toBe('2026-11-02'); // середа → понеділок
  });

  it('перелічує дні включно', () => {
    expect(eachDay('2026-11-01', '2026-11-03')).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    expect(eachDay('2026-11-03', '2026-11-01')).toEqual([]);
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
  });
});

describe('гроші', () => {
  it('розбирає NUMERIC без втрати копійок', () => {
    expect(parseNumeric('15000.00')).toBe(1_500_000);
    expect(parseNumeric('0.01')).toBe(1);
    expect(parseNumeric('-250.50')).toBe(-25_050);
    expect(parseNumeric('1234567890.99')).toBe(123_456_789_099);
    expect(parseNumeric(null)).toBe(0);
  });

  it('округлює третій знак за правилом «половина від нуля»', () => {
    expect(parseNumeric('1.005')).toBe(101);
    expect(parseNumeric('1.004')).toBe(100);
    expect(parseNumeric('-1.005')).toBe(-101);
  });

  it('повертає рядок для NUMERIC без експоненти', () => {
    expect(toNumeric(1_500_000)).toBe('15000.00');
    expect(toNumeric(1)).toBe('0.01');
    expect(toNumeric(-25_050)).toBe('-250.50');
    expect(toNumeric(0)).toBe('0.00');
  });

  it('не накопичує похибку float', () => {
    // 0.1 + 0.2 !== 0.3 у подвійній точності; у мінорних одиницях — точно.
    expect(fromMajor(0.1) + fromMajor(0.2)).toBe(fromMajor(0.3));

    let sum = 0;
    for (let i = 0; i < 1000; i++) sum += fromMajor(0.07);
    expect(toNumeric(sum)).toBe('70.00');
  });

  it('приймає кому як десятковий роздільник', () => {
    expect(fromMajor('149,50')).toBe(14_950);
    expect(fromMajor('1 234,56')).toBe(123_456);
  });

  it('ділить суму без втрати копійок', () => {
    const parts = splitEvenly(10_000, 3); // 100.00 на три
    expect(parts).toEqual([3334, 3333, 3333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10_000);

    const even = splitEvenly(2_400_000, 8); // 24000 на 8
    expect(new Set(even)).toEqual(new Set([300_000]));
    expect(even.reduce((a, b) => a + b, 0)).toBe(2_400_000);
  });

  it('рахує відсоток із банківським округленням', () => {
    expect(percentOf(10_000, 5)).toBe(500);
    expect(percentOf(333, 50)).toBe(167); // 166.5 → 167
  });

  it('конвертує у базову валюту', () => {
    const rates = { USD: 41.5, EUR: 45 };
    expect(toBase(10_000, 'UAH', 'UAH', rates)).toBe(10_000);
    expect(toBase(10_000, 'USD', 'UAH', rates)).toBe(415_000);
  });

  it('повертає null замість вигаданого курсу', () => {
    // Мовчки скласти долари з гривнями як рівні — найгірше, що можна зробити.
    expect(toBase(10_000, 'GBP', 'UAH', {})).toBeNull();

    const sum = sumInBase(
      [
        { amount: 10_000, currency: 'UAH' },
        { amount: 10_000, currency: 'GBP' },
      ],
      'UAH',
      {},
    );
    expect(sum.complete).toBe(false);
    expect(sum.missingCurrencies).toEqual(['GBP']);
    expect(sum.total).toBe(10_000);
  });

  it('форматує суми українською', () => {
    expect(formatMoney(1_500_000, 'UAH')).toMatch(/15\s?000,00\s?₴/);
    expect(formatMoney(-25_050, 'UAH')).toMatch(/^−/);
    expect(formatMoney(25_050, 'UAH', { sign: true })).toMatch(/^\+/);
    expect(formatMoney(1_500_000, 'UAH', { trimCents: true })).not.toMatch(/,00/);
  });
});
