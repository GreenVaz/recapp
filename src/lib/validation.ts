import { z } from "zod";
import { ACCOUNT_TYPES, CATEGORY_KINDS, CURRENCIES, FREQUENCIES, TX_TYPES } from "./constants";

/** Приймаємо суму в звичайних одиницях (149.5) — у мінорні переводимо в хендлері. */
const majorAmount = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === "string" ? Number(v.replace(",", ".").trim()) : v;
  if (!Number.isFinite(n)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Некоректна сума" });
    return z.NEVER;
  }
  return Math.round(n * 100);
});

const positiveAmount = majorAmount.refine((n) => n > 0, "Сума має бути більшою за нуль");

export const accountSchema = z.object({
  name: z.string().trim().min(1, "Вкажіть назву").max(60),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.enum(CURRENCIES),
  balance: majorAmount.default(0),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Колір у форматі #rrggbb").default("#3f6f5c"),
  isArchived: z.boolean().default(false),
});

export const accountUpdateSchema = accountSchema.partial();

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Вкажіть назву").max(60),
  kind: z.enum(CATEGORY_KINDS),
  icon: z.string().default("Circle"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#8a8a84"),
  parentId: z.string().nullable().optional(),
});

export const categoryUpdateSchema = categorySchema.partial();

export const transactionSchema = z
  .object({
    type: z.enum(TX_TYPES),
    amount: positiveAmount,
    toAmount: positiveAmount.optional().nullable(),
    date: z.string().or(z.date()),
    accountId: z.string().min(1, "Оберіть рахунок"),
    toAccountId: z.string().nullable().optional(),
    categoryId: z.string().nullable().optional(),
    note: z.string().max(300).nullable().optional(),
    tags: z.string().max(200).default(""),
  })
  .superRefine((val, ctx) => {
    if (val.type === "TRANSFER") {
      if (!val.toAccountId) {
        ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Оберіть рахунок призначення" });
      } else if (val.toAccountId === val.accountId) {
        ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "Рахунки мають відрізнятися" });
      }
    }
  });

export const transactionUpdateSchema = z.object({
  type: z.enum(TX_TYPES).optional(),
  amount: positiveAmount.optional(),
  toAmount: positiveAmount.nullable().optional(),
  date: z.string().or(z.date()).optional(),
  accountId: z.string().optional(),
  toAccountId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  note: z.string().max(300).nullable().optional(),
  tags: z.string().max(200).optional(),
});

export const budgetSchema = z.object({
  categoryId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/, "Місяць у форматі YYYY-MM"),
  amount: majorAmount,
});

export const recurringSchema = z.object({
  name: z.string().trim().min(1, "Вкажіть назву").max(80),
  type: z.enum(["EXPENSE", "INCOME"]),
  amount: positiveAmount,
  currency: z.enum(CURRENCIES),
  frequency: z.enum(FREQUENCIES),
  anchorDate: z.string().or(z.date()),
  reminderDays: z.number().int().min(0).max(30).default(3),
  autoPost: z.boolean().default(false),
  isActive: z.boolean().default(true),
  accountId: z.string().min(1, "Оберіть рахунок"),
  categoryId: z.string().nullable().optional(),
  note: z.string().max(300).nullable().optional(),
});

export const recurringUpdateSchema = recurringSchema.partial();

export const settingsSchema = z.object({
  baseCurrency: z.enum(CURRENCIES).optional(),
  defaultAccountId: z.string().nullable().optional(),
  rates: z
    .array(z.object({ base: z.string().length(3), quote: z.string().length(3), rate: z.number().positive() }))
    .optional(),
});

/** Fast-Entry: максимально поблажливий до того, що надішле Shortcuts. */
export const quickEntrySchema = z.object({
  amount: positiveAmount,
  type: z.enum(TX_TYPES).default("EXPENSE"),
  account: z.string().optional(),
  toAccount: z.string().optional(),
  category: z.string().optional(),
  note: z.string().max(300).optional(),
  date: z.string().optional(),
  tags: z.string().max(200).optional(),
});
