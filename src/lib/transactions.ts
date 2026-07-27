import type { Prisma, Transaction } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Баланс рахунку — денормалізоване поле, тож будь-яка зміна транзакції
 * має атомарно відкотити старий вплив і застосувати новий.
 * Усі операції тут обгорнуті в $transaction.
 */

type BalanceEffect = { accountId: string; delta: number };

function effectsOf(tx: {
  type: string;
  amount: number;
  toAmount: number | null;
  accountId: string;
  toAccountId: string | null;
}): BalanceEffect[] {
  switch (tx.type) {
    case "INCOME":
      return [{ accountId: tx.accountId, delta: tx.amount }];
    case "EXPENSE":
      return [{ accountId: tx.accountId, delta: -tx.amount }];
    case "TRANSFER":
      return tx.toAccountId
        ? [
            { accountId: tx.accountId, delta: -tx.amount },
            { accountId: tx.toAccountId, delta: tx.toAmount ?? tx.amount },
          ]
        : [{ accountId: tx.accountId, delta: -tx.amount }];
    default:
      return [];
  }
}

async function applyEffects(client: Prisma.TransactionClient, effects: BalanceEffect[], sign = 1) {
  // Згортаємо в мапу: переказ між тим самим рахунком не повинен давати два UPDATE.
  const totals = new Map<string, number>();
  for (const e of effects) {
    totals.set(e.accountId, (totals.get(e.accountId) ?? 0) + e.delta * sign);
  }
  for (const [accountId, delta] of totals) {
    if (delta === 0) continue;
    await client.account.update({
      where: { id: accountId },
      data: { balance: { increment: delta } },
    });
  }
}

export interface TxInput {
  type: string;
  amount: number;
  toAmount?: number | null;
  date: Date;
  accountId: string;
  toAccountId?: string | null;
  categoryId?: string | null;
  note?: string | null;
  tags?: string;
  mcc?: number | null;
  source?: string;
  externalId?: string | null;
  balanceAfter?: number | null;
}

export async function createTransaction(input: TxInput): Promise<Transaction> {
  return prisma.$transaction(async (client) => {
    const account = await client.account.findUnique({ where: { id: input.accountId } });
    if (!account) throw new Error("Рахунок не знайдено");

    if (input.type === "TRANSFER" && input.toAccountId) {
      const target = await client.account.findUnique({ where: { id: input.toAccountId } });
      if (!target) throw new Error("Рахунок призначення не знайдено");
      // Різні валюти вимагають явної суми зарахування, інакше баланс поїде.
      if (target.currency !== account.currency && !input.toAmount) {
        throw new Error(
          `Переказ ${account.currency} → ${target.currency}: вкажіть суму зарахування в ${target.currency}`,
        );
      }
    }

    const created = await client.transaction.create({
      data: {
        type: input.type,
        amount: input.amount,
        toAmount: input.toAmount ?? null,
        currency: account.currency,
        date: input.date,
        note: input.note ?? null,
        tags: input.tags ?? "",
        mcc: input.mcc ?? null,
        source: input.source ?? "MANUAL",
        externalId: input.externalId ?? null,
        balanceAfter: input.balanceAfter ?? null,
        accountId: input.accountId,
        toAccountId: input.type === "TRANSFER" ? (input.toAccountId ?? null) : null,
        categoryId: input.type === "TRANSFER" ? null : (input.categoryId ?? null),
      },
    });

    await applyEffects(client, effectsOf(created), 1);
    return created;
  });
}

export async function updateTransaction(id: string, patch: Partial<TxInput>): Promise<Transaction> {
  return prisma.$transaction(async (client) => {
    const existing = await client.transaction.findUnique({ where: { id } });
    if (!existing) throw new Error("Транзакцію не знайдено");

    // Спершу знімаємо старий вплив на баланси.
    await applyEffects(client, effectsOf(existing), -1);

    const nextType = patch.type ?? existing.type;
    const nextAccountId = patch.accountId ?? existing.accountId;
    const account = await client.account.findUnique({ where: { id: nextAccountId } });
    if (!account) throw new Error("Рахунок не знайдено");

    const nextToAccountId =
      nextType === "TRANSFER"
        ? patch.toAccountId !== undefined
          ? patch.toAccountId
          : existing.toAccountId
        : null;

    const updated = await client.transaction.update({
      where: { id },
      data: {
        type: nextType,
        amount: patch.amount ?? existing.amount,
        toAmount: patch.toAmount !== undefined ? patch.toAmount : existing.toAmount,
        currency: account.currency,
        date: patch.date ?? existing.date,
        note: patch.note !== undefined ? patch.note : existing.note,
        tags: patch.tags !== undefined ? patch.tags : existing.tags,
        accountId: nextAccountId,
        toAccountId: nextToAccountId,
        categoryId:
          nextType === "TRANSFER"
            ? null
            : patch.categoryId !== undefined
              ? patch.categoryId
              : existing.categoryId,
      },
    });

    await applyEffects(client, effectsOf(updated), 1);
    return updated;
  });
}

export async function deleteTransaction(id: string): Promise<void> {
  await prisma.$transaction(async (client) => {
    const existing = await client.transaction.findUnique({ where: { id } });
    if (!existing) throw new Error("Транзакцію не знайдено");
    await applyEffects(client, effectsOf(existing), -1);
    await client.transaction.delete({ where: { id } });
  });
}
