import { prisma } from "./prisma";
import { createTransaction } from "./transactions";
import type { Frequency } from "./constants";

/**
 * Наступна дата вважається від anchorDate, а не від попередньої нарахованої —
 * так «5 число щомісяця» лишається 5-м числом навіть після пропущених місяців.
 */
export function nextDueDate(anchor: Date, frequency: string, after: Date): Date {
  const next = new Date(anchor);
  const guard = 1000;
  let i = 0;

  while (next <= after && i < guard) {
    switch (frequency as Frequency) {
      case "WEEKLY":
        next.setDate(next.getDate() + 7);
        break;
      case "QUARTERLY":
        next.setMonth(next.getMonth() + 3);
        break;
      case "YEARLY":
        next.setFullYear(next.getFullYear() + 1);
        break;
      default:
        next.setMonth(next.getMonth() + 1);
    }
    i += 1;
  }
  return next;
}

export function daysUntil(date: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/** Проводить регулярний платіж і зсуває nextDueDate на наступний період. */
export async function postRecurring(id: string, date?: Date) {
  const rec = await prisma.recurringPayment.findUnique({ where: { id } });
  if (!rec) throw new Error("Платіж не знайдено");

  const postedAt = date ?? rec.nextDueDate;

  const tx = await createTransaction({
    type: rec.type,
    amount: rec.amount,
    date: postedAt,
    accountId: rec.accountId,
    categoryId: rec.categoryId,
    note: rec.note ? `${rec.name} — ${rec.note}` : rec.name,
    tags: "регулярний",
    source: "MANUAL",
  });

  await prisma.recurringPayment.update({
    where: { id },
    data: {
      lastPostedAt: postedAt,
      nextDueDate: nextDueDate(rec.anchorDate, rec.frequency, postedAt),
    },
  });

  return tx;
}

/** Платежі, які пора нагадати: у межах reminderDays або вже прострочені. */
export async function getDueReminders() {
  const items = await prisma.recurringPayment.findMany({
    where: { isActive: true },
    include: {
      account: { select: { name: true, currency: true } },
      category: { select: { name: true, icon: true, color: true } },
    },
    orderBy: { nextDueDate: "asc" },
  });

  return items
    .map((r) => ({ ...r, daysLeft: daysUntil(r.nextDueDate) }))
    .filter((r) => r.daysLeft <= r.reminderDays);
}
