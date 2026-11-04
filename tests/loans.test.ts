import { describe, expect, it } from 'vitest';
import {
  allocatePayment,
  annuityPayment,
  buildSchedule,
  rebuildRemaining,
  ScheduleError,
  summarizeLoan,
  type ScheduleSpec,
} from '@core/loans.ts';
import { toNumeric } from '@core/money.ts';
import type { LoanPayment, ScheduleRow } from '@core/types.ts';

const uah = (major: number) => Math.round(major * 100);

/** Інваріанти, яких має дотримуватися будь-який графік. */
function expectScheduleIsSound(rows: ScheduleRow[], principal: number) {
  const principalSum = rows.reduce((s, r) => s + r.principalPart, 0);
  expect(principalSum, 'сума часток тіла дорівнює кредиту').toBe(principal);
  expect(rows.at(-1)!.balanceAfter, 'останній платіж закриває борг у нуль').toBe(0);

  for (const row of rows) {
    expect(row.amount, `платіж ${row.seq} = тіло + відсотки + комісія`).toBe(
      row.principalPart + row.interestPart + row.feePart,
    );
    expect(row.amount).toBeGreaterThan(0);
    expect(row.balanceAfter).toBeGreaterThanOrEqual(0);
  }

  const dates = rows.map((r) => r.dueOn);
  expect([...dates].sort(), 'дати йдуть за зростанням').toEqual(dates);
}

describe('безвідсоткова розстрочка', () => {
  it('ділить 24 000 ₴ на 8 платежів по 3 000 ₴ (сценарій приймання з ТЗ)', () => {
    const rows = buildSchedule({
      principal: uah(24_000),
      rateAnnual: null,
      scheduleType: 'interest_free',
      paymentsCount: 8,
      firstPaymentOn: '2026-12-01',
    });

    expect(rows).toHaveLength(8);
    expect(rows.every((r) => r.amount === uah(3000))).toBe(true);
    expect(rows.every((r) => r.interestPart === 0)).toBe(true);
    expect(rows.map((r) => r.dueOn)).toEqual([
      '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01',
      '2027-04-01', '2027-05-01', '2027-06-01', '2027-07-01',
    ]);
    expectScheduleIsSound(rows, uah(24_000));
  });

  it('не губить копійки на сумі, що не ділиться націло', () => {
    const rows = buildSchedule({
      principal: uah(10_000),
      rateAnnual: null,
      scheduleType: 'interest_free',
      paymentsCount: 3,
      firstPaymentOn: '2026-12-10',
    });
    expect(rows.map((r) => toNumeric(r.amount))).toEqual(['3333.34', '3333.33', '3333.33']);
    expectScheduleIsSound(rows, uah(10_000));
  });

  it('тримає число місяця, обрізаючи короткі місяці', () => {
    const rows = buildSchedule({
      principal: uah(12_000),
      rateAnnual: null,
      scheduleType: 'interest_free',
      paymentsCount: 4,
      firstPaymentOn: '2026-12-31',
    });
    expect(rows.map((r) => r.dueOn)).toEqual([
      '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31',
    ]);
  });
});

describe('ануїтет', () => {
  const spec: ScheduleSpec = {
    principal: uah(100_000),
    rateAnnual: 18,
    scheduleType: 'annuity',
    paymentsCount: 12,
    firstPaymentOn: '2026-12-05',
  };

  it('тримає рівний платіж і гасить борг у нуль', () => {
    const rows = buildSchedule(spec);
    expectScheduleIsSound(rows, uah(100_000));

    const regular = rows.slice(0, -1).map((r) => r.amount);
    expect(new Set(regular).size, 'усі платежі, крім останнього, однакові').toBe(1);
    expect(regular[0]).toBe(annuityPayment(uah(100_000), 18, 12));
  });

  it('з часом частка відсотків падає, а частка тіла зростає', () => {
    const rows = buildSchedule(spec);
    expect(rows[0]!.interestPart).toBeGreaterThan(rows.at(-1)!.interestPart);
    expect(rows[0]!.principalPart).toBeLessThan(rows.at(-1)!.principalPart);
    // Перший місяць: 100 000 × 18% / 12 = 1 500 ₴
    expect(rows[0]!.interestPart).toBe(uah(1500));
  });

  it('переплата дорівнює сумі відсотків', () => {
    const rows = buildSchedule(spec);
    const summary = summarizeLoan({ principal: uah(100_000), isClosed: false }, rows, []);
    const interestTotal = rows.reduce((s, r) => s + r.interestPart, 0);
    expect(summary.overpayment).toBe(interestTotal);
    expect(summary.outstandingPrincipal).toBe(uah(100_000));
    expect(summary.progressPercent).toBe(0);
  });

  it('нульова ставка зводиться до рівних часток тіла', () => {
    const rows = buildSchedule({ ...spec, rateAnnual: 0 });
    expect(rows.every((r) => r.interestPart === 0)).toBe(true);
    expectScheduleIsSound(rows, uah(100_000));
  });
});

describe('диференційований графік', () => {
  it('тримає рівне тіло і спадний платіж', () => {
    const rows = buildSchedule({
      principal: uah(60_000),
      rateAnnual: 24,
      scheduleType: 'differentiated',
      paymentsCount: 6,
      firstPaymentOn: '2026-12-15',
    });

    expectScheduleIsSound(rows, uah(60_000));
    expect(rows.every((r) => r.principalPart === uah(10_000))).toBe(true);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.amount).toBeLessThan(rows[i - 1]!.amount);
    }
    // Перший місяць: 60 000 × 24% / 12 = 1 200 ₴
    expect(rows[0]!.interestPart).toBe(uah(1200));
    expect(rows.at(-1)!.interestPart).toBe(uah(200)); // на залишок 10 000
  });
});

describe('відома лише загальна сума', () => {
  it('будує рівний графік і рознесе переплату', () => {
    const rows = buildSchedule({
      principal: uah(24_000),
      rateAnnual: null,
      scheduleType: 'fixed_equal',
      paymentsCount: 8,
      totalDue: uah(28_000),
      firstPaymentOn: '2026-12-01',
    });

    expectScheduleIsSound(rows, uah(24_000));
    expect(rows.every((r) => r.amount === uah(3500))).toBe(true);
    expect(rows.every((r) => r.principalPart === uah(3000))).toBe(true);
    expect(rows.every((r) => r.interestPart === uah(500))).toBe(true);
  });

  it('відхиляє загальну суму, меншу за тіло', () => {
    expect(() =>
      buildSchedule({
        principal: uah(24_000),
        rateAnnual: null,
        scheduleType: 'fixed_equal',
        paymentsCount: 8,
        totalDue: uah(20_000),
        firstPaymentOn: '2026-12-01',
      }),
    ).toThrow(ScheduleError);
  });
});

describe('комісії', () => {
  it('додає фіксовану і відсоткову комісію поверх платежу', () => {
    const rows = buildSchedule({
      principal: uah(12_000),
      rateAnnual: null,
      scheduleType: 'interest_free',
      paymentsCount: 4,
      firstPaymentOn: '2026-12-01',
      feeFixed: uah(50),
      feePercent: 1,
    });

    // 3000 тіла + 50 фікс + 1% від 3000 = 3080
    expect(rows[0]!.feePart).toBe(uah(80));
    expect(rows[0]!.amount).toBe(uah(3080));
    expectScheduleIsSound(rows, uah(12_000));
  });
});

describe('ручний графік', () => {
  it('приймає довільні дати й суми', () => {
    const rows = buildSchedule({
      principal: uah(10_000),
      rateAnnual: null,
      scheduleType: 'manual',
      paymentsCount: 0,
      firstPaymentOn: '2026-12-01',
      manualRows: [
        { dueOn: '2026-12-20', amount: uah(2000) },
        { dueOn: '2027-02-10', amount: uah(3000) },
        { dueOn: '2027-05-05', amount: uah(5000) },
      ],
    });

    expect(rows.map((r) => r.dueOn)).toEqual(['2026-12-20', '2027-02-10', '2027-05-05']);
    expectScheduleIsSound(rows, uah(10_000));
  });
});

describe('день платежу', () => {
  it('зсуває перший платіж на вказане число', () => {
    const rows = buildSchedule({
      principal: uah(9000),
      rateAnnual: null,
      scheduleType: 'interest_free',
      paymentsCount: 3,
      firstPaymentOn: '2026-12-01',
      paymentDay: 15,
    });
    expect(rows.map((r) => r.dueOn)).toEqual(['2026-12-15', '2027-01-15', '2027-02-15']);
  });

  it('переносить на наступний місяць, якщо число вже минуло', () => {
    const rows = buildSchedule({
      principal: uah(6000),
      rateAnnual: null,
      scheduleType: 'interest_free',
      paymentsCount: 2,
      firstPaymentOn: '2026-12-20',
      paymentDay: 5,
    });
    expect(rows.map((r) => r.dueOn)).toEqual(['2027-01-05', '2027-02-05']);
  });
});

describe('розподіл фактичного платежу', () => {
  it('гасить спершу комісію, потім відсотки, решта — тіло', () => {
    const result = allocatePayment(uah(3000), { interestPart: uah(1500), feePart: uah(50) }, uah(100_000));
    expect(result.feePart).toBe(uah(50));
    expect(result.interestPart).toBe(uah(1500));
    expect(result.principalPart).toBe(uah(1450));
    expect(result.excess).toBe(0);
  });

  it('часткова оплата не доходить до тіла', () => {
    const result = allocatePayment(uah(1000), { interestPart: uah(1500), feePart: uah(50) }, uah(100_000));
    expect(result.feePart).toBe(uah(50));
    expect(result.interestPart).toBe(uah(950));
    expect(result.principalPart).toBe(0);
  });

  it('переплата понад борг не йде в мінус', () => {
    const result = allocatePayment(uah(5000), { interestPart: 0, feePart: 0 }, uah(2000));
    expect(result.principalPart).toBe(uah(2000));
    expect(result.excess).toBe(uah(3000));
  });
});

describe('дострокове погашення', () => {
  const spec: ScheduleSpec = {
    principal: uah(100_000),
    rateAnnual: 18,
    scheduleType: 'annuity',
    paymentsCount: 12,
    firstPaymentOn: '2026-12-05',
  };

  it('скорочення строку лишає платіж і зменшує кількість місяців', () => {
    const original = buildSchedule(spec);
    const payment = original[0]!.amount;

    const tail = rebuildRemaining({
      spec,
      outstanding: uah(50_000),
      nextDueOn: '2027-03-05',
      remainingCount: 9,
      currentPayment: payment,
      strategy: 'reduce_term',
      startSeq: 4,
    });

    expect(tail.length).toBeLessThan(9);
    expect(tail[0]!.seq).toBe(4);
    expectScheduleIsSound(tail, uah(50_000));
    // Платіж лишається приблизно тим самим (останній менший).
    expect(tail[0]!.amount).toBeCloseTo(payment, -2);
  });

  it('скорочення платежу лишає кількість місяців і зменшує суму', () => {
    const original = buildSchedule(spec);
    const payment = original[0]!.amount;

    const tail = rebuildRemaining({
      spec,
      outstanding: uah(50_000),
      nextDueOn: '2027-03-05',
      remainingCount: 9,
      currentPayment: payment,
      strategy: 'reduce_payment',
      startSeq: 4,
    });

    expect(tail).toHaveLength(9);
    expect(tail[0]!.amount).toBeLessThan(payment);
    expectScheduleIsSound(tail, uah(50_000));
  });

  it('повне дострокове погашення закриває графік', () => {
    const tail = rebuildRemaining({
      spec,
      outstanding: 0,
      nextDueOn: '2027-03-05',
      remainingCount: 9,
      currentPayment: uah(9168),
      strategy: 'reduce_term',
      startSeq: 4,
    });
    expect(tail).toEqual([]);
  });
});

describe('зведення по кредиту', () => {
  it('не плутає залишок тіла із сумою майбутніх платежів', () => {
    const rows = buildSchedule({
      principal: uah(24_000),
      rateAnnual: null,
      scheduleType: 'fixed_equal',
      paymentsCount: 8,
      totalDue: uah(28_000),
      firstPaymentOn: '2026-12-01',
    });

    // Перші два платежі сплачено.
    const paid: LoanPayment[] = [0, 1].map((i) => ({
      id: `p${i}`,
      loanId: 'l1',
      scheduleId: `s${i}`,
      transactionId: `t${i}`,
      paidOn: rows[i]!.dueOn,
      amount: rows[i]!.amount,
      principalPart: rows[i]!.principalPart,
      interestPart: rows[i]!.interestPart,
      feePart: 0,
      kind: 'scheduled',
      earlyStrategy: null,
    }));
    const schedule = rows.map((r, i) => (i < 2 ? { ...r, status: 'paid' as const } : r));

    const summary = summarizeLoan({ principal: uah(24_000), isClosed: false }, schedule, paid);

    expect(summary.outstandingPrincipal, 'залишок ТІЛА').toBe(uah(18_000));
    expect(summary.remainingToPay, 'сума майбутніх ПЛАТЕЖІВ').toBe(uah(21_000));
    expect(summary.principalPaid).toBe(uah(6000));
    expect(summary.interestPaid).toBe(uah(1000));
    expect(summary.progressPercent).toBeCloseTo(25, 5);
    expect(summary.nextPayment?.dueOn).toBe('2027-02-01');
    expect(summary.closingDate).toBe('2027-07-01');
    expect(summary.totalCost).toBe(uah(28_000));
  });

  it('позначає кредит закритим, коли тіло погашене', () => {
    const rows = buildSchedule({
      principal: uah(3000),
      rateAnnual: null,
      scheduleType: 'interest_free',
      paymentsCount: 1,
      firstPaymentOn: '2026-12-01',
    });
    const paid: LoanPayment[] = [
      {
        id: 'p', loanId: 'l', scheduleId: 's', transactionId: 't',
        paidOn: '2026-12-01', amount: uah(3000), principalPart: uah(3000),
        interestPart: 0, feePart: 0, kind: 'scheduled', earlyStrategy: null,
      },
    ];
    const summary = summarizeLoan(
      { principal: uah(3000), isClosed: false },
      rows.map((r) => ({ ...r, status: 'paid' as const })),
      paid,
    );
    expect(summary.isClosed).toBe(true);
    expect(summary.progressPercent).toBe(100);
    expect(summary.nextPayment).toBeNull();
  });
});
