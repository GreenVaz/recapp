import { describe, expect, it } from 'vitest';
import {
  accountTitle,
  bankDay,
  currencyFromCode,
  dayEndUnix,
  dayStartUnix,
  initialBalanceFor,
  jarTitle,
  planWindows,
  signedAmount,
  toTransactionDraft,
  midRate,
  ratesFromMono,
  type MonoStatementItem,
} from '@core/monobank.js';

const item = (over: Partial<MonoStatementItem> = {}): MonoStatementItem => ({
  id: 'abc123',
  time: 1_767_200_000,
  description: 'Сільпо',
  mcc: 5411,
  hold: false,
  amount: -24550,
  operationAmount: -24550,
  currencyCode: 980,
  ...over,
});

describe('валюти', () => {
  it('переводить числові коди в літерні', () => {
    expect(currencyFromCode(980)).toBe('UAH');
    expect(currencyFromCode(840)).toBe('USD');
    expect(currencyFromCode(978)).toBe('EUR');
  });

  it('повертає null для невідомого коду, а не вигадує валюту', () => {
    expect(currencyFromCode(1)).toBeNull();
  });
});

describe('календарний день банку', () => {
  // 2026-01-15 23:30 за Києвом — це ще 21:30 того ж дня в UTC, тож тут
  // розбіжності немає. Наступний випадок — складніший.
  it('бере день у київському поясі, а не в UTC', () => {
    // 2026-01-15T22:30:00Z = 2026-01-16 00:30 за Києвом (зима, UTC+2).
    expect(bankDay(Date.parse('2026-01-15T22:30:00Z') / 1000)).toBe('2026-01-16');
    // На годину раніше — ще 15 січня.
    expect(bankDay(Date.parse('2026-01-15T21:30:00Z') / 1000)).toBe('2026-01-15');
  });

  it('враховує літній час', () => {
    // Влітку Київ UTC+3, тож межа доби зсувається на 21:00 UTC.
    expect(bankDay(Date.parse('2026-07-15T21:30:00Z') / 1000)).toBe('2026-07-16');
    expect(bankDay(Date.parse('2026-07-15T20:30:00Z') / 1000)).toBe('2026-07-15');
  });

  it('межі доби узгоджені з bankDay', () => {
    for (const date of ['2026-01-15', '2026-07-15', '2026-03-29', '2026-10-25']) {
      expect(bankDay(dayStartUnix(date))).toBe(date);
      expect(bankDay(dayEndUnix(date))).toBe(date);
      // Секунда до початку доби належить попередньому дню.
      expect(bankDay(dayStartUnix(date) - 1)).not.toBe(date);
    }
  });
});

describe('планування вікон', () => {
  it('ділить діапазон на шматки не довші за дозволені', () => {
    const windows = planWindows('2026-01-01', '2026-03-31', 31);
    expect(windows).toHaveLength(3);
    for (const w of windows) {
      const days = (Date.parse(w.to) - Date.parse(w.from)) / 86_400_000 + 1;
      expect(days).toBeLessThanOrEqual(31);
    }
  });

  it('вікна покривають діапазон без дір і перекриттів', () => {
    const windows = [...planWindows('2026-01-01', '2026-03-31', 31)].reverse();
    expect(windows[0]!.from).toBe('2026-01-01');
    expect(windows.at(-1)!.to).toBe('2026-03-31');
    for (let i = 1; i < windows.length; i += 1) {
      const prevEnd = Date.parse(windows[i - 1]!.to);
      const thisStart = Date.parse(windows[i]!.from);
      expect(thisStart - prevEnd).toBe(86_400_000);
    }
  });

  it('віддає найсвіжіше вікно першим', () => {
    const windows = planWindows('2026-01-01', '2026-03-31', 31);
    expect(windows[0]!.to).toBe('2026-03-31');
  });

  it('діапазон в один день — одне вікно', () => {
    expect(planWindows('2026-01-05', '2026-01-05')).toEqual([
      { from: '2026-01-05', to: '2026-01-05' },
    ]);
  });

  it('перевернутий діапазон не дає вікон', () => {
    expect(planWindows('2026-03-01', '2026-01-01')).toEqual([]);
  });
});

describe('операції', () => {
  it('відʼємна сума стає витратою з додатним значенням', () => {
    const draft = toTransactionDraft(item(), 'UAH');
    expect(draft.kind).toBe('expense');
    expect(draft.amount).toBe(24550);
    expect(draft.currency).toBe('UAH');
    expect(draft.externalId).toBe('mono:abc123');
  });

  it('додатна сума стає доходом', () => {
    expect(toTransactionDraft(item({ amount: 500000 }), 'UAH').kind).toBe('income');
  });

  it('бере суму у валюті рахунку, а не операції', () => {
    // Покупка на 12.00 USD з гривневої картки списала 504.00 грн.
    const draft = toTransactionDraft(
      item({ amount: -50400, operationAmount: -1200, currencyCode: 840 }),
      'UAH',
    );
    expect(draft.amount).toBe(50400);
    expect(draft.currency).toBe('UAH');
    // Початкова валюта не губиться — вона в коментарі.
    expect(draft.note).toContain('12.00 USD');
  });

  it('не дописує валюту, коли вона збігається з рахунком', () => {
    expect(toTransactionDraft(item(), 'UAH').note).toBe('Сільпо');
  });

  it('зберігає власний коментар користувача', () => {
    const draft = toTransactionDraft(item({ comment: 'на день народження' }), 'UAH');
    expect(draft.note).toBe('Сільпо · на день народження');
  });

  it('порожній опис не дає порожнього рядка', () => {
    expect(toTransactionDraft(item({ description: '  ' }), 'UAH').note).toBeNull();
  });

  it('позначає незавершені операції', () => {
    expect(toTransactionDraft(item({ hold: true }), 'UAH').hold).toBe(true);
  });

  it('знакова сума відновлює напрям', () => {
    expect(signedAmount(toTransactionDraft(item(), 'UAH'))).toBe(-24550);
    expect(signedAmount(toTransactionDraft(item({ amount: 300 }), 'UAH'))).toBe(300);
  });
});

describe('початковий залишок', () => {
  it('підібраний так, щоб поточний баланс зійшовся', () => {
    // Банк каже 5197.17; завантажені операції дали −41400.50.
    const initial = initialBalanceFor(519717, -4140050);
    expect(initial).toBe(4659767);
    expect(initial + -4140050).toBe(519717);
  });
});

describe('назви', () => {
  it('картка показує тип і останні цифри', () => {
    expect(
      accountTitle({
        id: 'x', balance: 0, creditLimit: 0, type: 'black',
        currencyCode: 980, maskedPan: ['444111******9198'],
      }),
    ).toBe('Чорна 9198');
  });

  it('валютна картка несе валюту в назві', () => {
    expect(
      accountTitle({
        id: 'x', balance: 0, creditLimit: 0, type: 'black',
        currencyCode: 840, maskedPan: ['444111******1589'],
      }),
    ).toBe('Чорна 1589 USD');
  });

  it('банка підписана своєю назвою', () => {
    expect(jarTitle({ id: 'j', title: 'На кварту', currencyCode: 980, balance: 0 }))
      .toBe('Банка «На кварту»');
  });
});

describe('курси валют', () => {
  const usd = { currencyCodeA: 840, currencyCodeB: 980, date: 0, rateBuy: 41.2, rateSell: 41.8 };
  const eur = { currencyCodeA: 978, currencyCodeB: 980, date: 0, rateBuy: 47.5, rateSell: 48.5 };

  it('бере середину між купівлею і продажем', () => {
    expect(midRate(usd)).toBeCloseTo(41.5, 6);
    expect(midRate(eur)).toBeCloseTo(48.0, 6);
  });

  it('для валют без обміну бере кроскурс', () => {
    expect(midRate({ currencyCodeA: 826, currencyCodeB: 980, date: 0, rateCross: 55.3 })).toBe(55.3);
  });

  it('без жодного курсу повертає null, а не нуль', () => {
    expect(midRate({ currencyCodeA: 826, currencyCodeB: 980, date: 0 })).toBeNull();
  });

  it('витягає лише потрібні пари до гривні', () => {
    const rows = ratesFromMono([
      usd,
      eur,
      // USD до EUR — не наша пара.
      { currencyCodeA: 840, currencyCodeB: 978, date: 0, rateCross: 0.86 },
      // Валюта, якої застосунок не підтримує.
      { currencyCodeA: 392, currencyCodeB: 980, date: 0, rateCross: 0.27 },
    ]);

    expect(rows).toEqual([
      { base: 'USD', quote: 'UAH', rate: 41.5 },
      { base: 'EUR', quote: 'UAH', rate: 48 },
    ]);
  });

  it('порожня відповідь не ламає розбір', () => {
    expect(ratesFromMono([])).toEqual([]);
  });

  it('запис із нульовим курсом відкидається', () => {
    expect(
      ratesFromMono([{ currencyCodeA: 840, currencyCodeB: 980, date: 0, rateCross: 0 }]),
    ).toEqual([]);
  });
});
