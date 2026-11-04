import { z } from 'zod';

/**
 * Валідація входу API.
 *
 * Суми скрізь приходять ЦІЛИМИ мінорними одиницями (1500000 = 15 000,00).
 * Клієнт користується тим самим ядром money.ts, тож дробових чисел у
 * протоколі немає взагалі — і округлювати на межі нічого не треба.
 */

const money = z.number().int('Сума має бути цілим числом мінорних одиниць');
const positiveMoney = money.positive('Сума має бути більшою за нуль');
const dateISO = z.iso.date('Дата у форматі РРРР-ММ-ДД');
const uuid = z.uuid('Некоректний ідентифікатор');
const currency = z.enum(['UAH', 'USD', 'EUR']);
const colorHex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Колір у форматі #rrggbb');
const name = z.string().trim().min(1, 'Вкажіть назву').max(60);

// ─── Автентифікація ─────────────────────────────────────────────────────

export const credentialsSchema = z.object({
  email: z.email('Некоректна пошта').max(254),
  password: z.string().min(8, 'Пароль має містити щонайменше 8 символів').max(200),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Вкажіть поточний пароль'),
  newPassword: z.string().min(8, 'Новий пароль має містити щонайменше 8 символів').max(200),
});

export const forgotPasswordSchema = z.object({ email: z.email().max(254) });

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8, 'Пароль має містити щонайменше 8 символів').max(200),
});

// ─── Рахунки ────────────────────────────────────────────────────────────

export const accountCreateSchema = z.object({
  name,
  type: z.enum(['card', 'bank', 'cash', 'savings', 'other']).default('card'),
  currency: currency.default('UAH'),
  initialBalance: money.default(0),
  color: colorHex.default('#2f6bff'),
  icon: z.string().max(40).default('Wallet'),
});

export const accountUpdateSchema = accountCreateSchema.partial().extend({
  isArchived: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

/** Коригування: користувач називає бажаний залишок, різниця стає операцією. */
export const balanceAdjustSchema = z.object({
  targetBalance: money,
  occurredOn: dateISO.optional(),
  note: z.string().max(300).optional(),
});

// ─── Категорії ──────────────────────────────────────────────────────────

export const categoryCreateSchema = z.object({
  name,
  kind: z.enum(['income', 'expense']),
  parentId: uuid.nullable().optional(),
  icon: z.string().max(40).default('Circle'),
  color: colorHex.default('#8b8f9a'),
});

export const categoryUpdateSchema = categoryCreateSchema.partial().extend({
  isArchived: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

// ─── Транзакції ─────────────────────────────────────────────────────────

export const transactionCreateSchema = z
  .object({
    kind: z.enum(['income', 'expense', 'transfer', 'adjustment']),
    accountId: uuid,
    counterAccountId: uuid.nullable().optional(),
    counterAmount: positiveMoney.nullable().optional(),
    categoryId: uuid.nullable().optional(),
    amount: money,
    occurredOn: dateISO,
    status: z.enum(['planned', 'posted']).default('posted'),
    note: z.string().max(300).nullable().optional(),
    tags: z.array(z.string().max(40)).max(20).default([]),
    recurringRuleId: uuid.nullable().optional(),
    recurringOccurrence: dateISO.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'adjustment') {
      if (value.amount === 0) {
        ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Коригування не може бути нульовим' });
      }
    } else if (value.amount <= 0) {
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Сума має бути більшою за нуль' });
    }

    if (value.kind === 'transfer') {
      if (!value.counterAccountId) {
        ctx.addIssue({ code: 'custom', path: ['counterAccountId'], message: 'Оберіть рахунок призначення' });
      } else if (value.counterAccountId === value.accountId) {
        ctx.addIssue({ code: 'custom', path: ['counterAccountId'], message: 'Рахунки мають відрізнятися' });
      }
      if (value.categoryId) {
        ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Переказ не має категорії' });
      }
    } else if (value.counterAccountId) {
      ctx.addIssue({ code: 'custom', path: ['counterAccountId'], message: 'Рахунок призначення лише для переказу' });
    }

    if (Boolean(value.recurringRuleId) !== Boolean(value.recurringOccurrence)) {
      ctx.addIssue({
        code: 'custom',
        path: ['recurringOccurrence'],
        message: 'Повторення має бути вказане разом із правилом',
      });
    }
  });

export const transactionUpdateSchema = z.object({
  kind: z.enum(['income', 'expense', 'transfer', 'adjustment']).optional(),
  accountId: uuid.optional(),
  counterAccountId: uuid.nullable().optional(),
  counterAmount: positiveMoney.nullable().optional(),
  categoryId: uuid.nullable().optional(),
  amount: money.optional(),
  occurredOn: dateISO.optional(),
  status: z.enum(['planned', 'posted']).optional(),
  note: z.string().max(300).nullable().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

// ─── Регулярні правила ──────────────────────────────────────────────────

export const recurringCreateSchema = z
  .object({
    kind: z.enum(['income', 'expense', 'transfer']),
    accountId: uuid,
    counterAccountId: uuid.nullable().optional(),
    categoryId: uuid.nullable().optional(),
    amount: positiveMoney,
    currency: currency.default('UAH'),
    note: z.string().max(300).nullable().optional(),
    freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
    step: z.number().int().min(1).max(365).default(1),
    anchorDate: dateISO,
    endDate: dateISO.nullable().optional(),
    maxOccurrences: z.number().int().positive().nullable().optional(),
    monthEndPolicy: z.enum(['clamp', 'skip']).default('clamp'),
    autoPost: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'transfer' && !value.counterAccountId) {
      ctx.addIssue({ code: 'custom', path: ['counterAccountId'], message: 'Оберіть рахунок призначення' });
    }
    if (value.endDate && value.endDate < value.anchorDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Кінець серії раніше за її початок' });
    }
  });

export const recurringUpdateSchema = z.object({
  kind: z.enum(['income', 'expense', 'transfer']).optional(),
  accountId: uuid.optional(),
  counterAccountId: uuid.nullable().optional(),
  categoryId: uuid.nullable().optional(),
  amount: positiveMoney.optional(),
  currency: currency.optional(),
  note: z.string().max(300).nullable().optional(),
  freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']).optional(),
  step: z.number().int().min(1).max(365).optional(),
  anchorDate: dateISO.optional(),
  endDate: dateISO.nullable().optional(),
  maxOccurrences: z.number().int().positive().nullable().optional(),
  monthEndPolicy: z.enum(['clamp', 'skip']).optional(),
  autoPost: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

/** Правка одного повторення серії. */
export const occurrenceEditSchema = z
  .object({
    occurrenceDate: dateISO,
    action: z.enum(['skip', 'move', 'override']),
    newDate: dateISO.nullable().optional(),
    newAmount: positiveMoney.nullable().optional(),
    newNote: z.string().max(300).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'move' && !value.newDate) {
      ctx.addIssue({ code: 'custom', path: ['newDate'], message: 'Вкажіть нову дату' });
    }
    if (value.action === 'override' && value.newAmount === undefined && !value.newNote) {
      ctx.addIssue({ code: 'custom', path: ['newAmount'], message: 'Вкажіть, що саме змінюється' });
    }
  });

// ─── Кредити ────────────────────────────────────────────────────────────

export const loanCreateSchema = z
  .object({
    name: z.string().trim().min(1, 'Вкажіть назву').max(80),
    lender: z.string().max(80).nullable().optional(),
    kind: z
      .enum(['loan', 'credit_card', 'installment', 'pay_in_parts', 'personal', 'interest_free'])
      .default('loan'),
    principal: positiveMoney,
    currency: currency.default('UAH'),
    openedOn: dateISO,
    termMonths: z.number().int().positive().max(600).nullable().optional(),
    rateInput: z.number().min(0).max(1000).nullable().optional(),
    ratePeriod: z.enum(['annual', 'monthly']).nullable().optional(),
    scheduleType: z.enum(['annuity', 'differentiated', 'interest_free', 'fixed_equal', 'manual']),
    paymentDay: z.number().int().min(1).max(31).nullable().optional(),
    firstPaymentOn: dateISO,
    paymentsCount: z.number().int().positive().max(600).nullable().optional(),
    totalDue: positiveMoney.nullable().optional(),
    feeFixed: money.min(0).default(0),
    feePercent: z.number().min(0).max(100).default(0),
    accountId: uuid.nullable().optional(),
    categoryId: uuid.nullable().optional(),
    note: z.string().max(300).nullable().optional(),
    manualRows: z
      .array(z.object({ dueOn: dateISO, amount: positiveMoney, principalPart: money.min(0).optional() }))
      .max(600)
      .optional(),
  })
  .superRefine((value, ctx) => {
    const needsCount = value.scheduleType !== 'manual';
    const count = value.paymentsCount ?? value.termMonths;
    if (needsCount && !count) {
      ctx.addIssue({
        code: 'custom',
        path: ['paymentsCount'],
        message: 'Вкажіть кількість платежів або строк у місяцях',
      });
    }
    if (value.scheduleType === 'manual' && !value.manualRows?.length) {
      ctx.addIssue({ code: 'custom', path: ['manualRows'], message: 'Додайте хоча б один платіж' });
    }
    if (value.scheduleType === 'fixed_equal' && !value.totalDue) {
      ctx.addIssue({ code: 'custom', path: ['totalDue'], message: 'Вкажіть загальну суму до виплати' });
    }
    if (
      (value.scheduleType === 'annuity' || value.scheduleType === 'differentiated') &&
      (value.rateInput === null || value.rateInput === undefined)
    ) {
      ctx.addIssue({ code: 'custom', path: ['rateInput'], message: 'Вкажіть відсоткову ставку' });
    }
  });

export const loanUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  lender: z.string().max(80).nullable().optional(),
  accountId: uuid.nullable().optional(),
  categoryId: uuid.nullable().optional(),
  note: z.string().max(300).nullable().optional(),
  isClosed: z.boolean().optional(),
});

export const loanPaymentSchema = z
  .object({
    scheduleId: uuid.nullable().optional(),
    paidOn: dateISO,
    amount: positiveMoney,
    accountId: uuid.nullable().optional(),
    kind: z.enum(['scheduled', 'extra', 'partial']).default('scheduled'),
    earlyStrategy: z.enum(['reduce_term', 'reduce_payment']).nullable().optional(),
    note: z.string().max(300).nullable().optional(),
    /** false — лише зафіксувати факт, не створюючи рух грошей. */
    createTransaction: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'scheduled' && !value.scheduleId) {
      ctx.addIssue({ code: 'custom', path: ['scheduleId'], message: 'Оберіть платіж із графіка' });
    }
  });

// ─── Налаштування ───────────────────────────────────────────────────────

export const settingsUpdateSchema = z.object({
  baseCurrency: currency.optional(),
  theme: z.enum(['dark', 'light', 'system']).optional(),
  locale: z.string().max(10).optional(),
  weekStart: z.number().int().min(0).max(6).optional(),
  displayName: z.string().max(80).nullable().optional(),
});

export const ratesUpdateSchema = z.object({
  rates: z
    .array(z.object({ base: currency, quote: currency, rate: z.number().positive().max(1_000_000) }))
    .max(20),
});

// ─── Діапазон дат ───────────────────────────────────────────────────────

export const rangeSchema = z.object({
  from: dateISO,
  to: dateISO,
});

export const importSchema = z.object({
  /** Для безпечного імпорту клієнт спершу просить попередній перегляд. */
  mode: z.enum(['preview', 'apply']).default('preview'),
  payload: z.object({
    version: z.number().int().optional(),
    accounts: z.array(z.record(z.string(), z.unknown())).default([]),
    categories: z.array(z.record(z.string(), z.unknown())).default([]),
    transactions: z.array(z.record(z.string(), z.unknown())).default([]),
    recurringRules: z.array(z.record(z.string(), z.unknown())).default([]),
    recurringExceptions: z.array(z.record(z.string(), z.unknown())).default([]),
    loans: z.array(z.record(z.string(), z.unknown())).default([]),
    loanSchedules: z.array(z.record(z.string(), z.unknown())).default([]),
    loanPayments: z.array(z.record(z.string(), z.unknown())).default([]),
    exchangeRates: z.array(z.record(z.string(), z.unknown())).default([]),
    settings: z.record(z.string(), z.unknown()).optional(),
  }),
});
