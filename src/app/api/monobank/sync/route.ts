import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { fail, ok } from "@/lib/api";
import { getMonobankToken } from "@/lib/settings";
import { getClientInfo, getStatement, MonobankError } from "@/lib/monobank";
import { buildCategoryResolver } from "@/lib/categorize";
import { CURRENCY_BY_NUMERIC } from "@/lib/constants";

const schema = z.object({
  /** Скільки діб історії тягнути. Monobank дозволяє максимум 31 за запит. */
  days: z.number().int().min(1).max(31).default(31),
  accountIds: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  const token = await getMonobankToken();
  if (!token) return fail("Токен Monobank не налаштований", 400);

  const body = await req.json().catch(() => ({}));
  const { days, accountIds } = schema.parse(body);

  const linked = await prisma.account.findMany({
    where: {
      monoAccountId: { not: null },
      ...(accountIds?.length ? { id: { in: accountIds } } : {}),
    },
  });

  if (linked.length === 0) {
    return fail("Немає прив'язаних рахунків Monobank. Прив'яжіть їх у налаштуваннях.", 400);
  }

  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  const resolver = await buildCategoryResolver();

  const report = {
    balancesUpdated: 0,
    imported: 0,
    skipped: 0,
    accounts: [] as Array<{ name: string; imported: number; skipped: number; error?: string }>,
  };

  try {
    // 1. Баланси — джерело істини на боці банку.
    const info = await getClientInfo(token);
    const monoBalances = new Map<string, { balance: number; currency: string }>();
    for (const a of info.accounts) {
      monoBalances.set(a.id, {
        balance: a.balance,
        currency: CURRENCY_BY_NUMERIC[a.currencyCode] ?? "UAH",
      });
    }
    for (const j of info.jars ?? []) {
      monoBalances.set(j.id, {
        balance: j.balance,
        currency: CURRENCY_BY_NUMERIC[j.currencyCode] ?? "UAH",
      });
    }

    // 2. Виписки. Кожен рахунок — окреме вікно ліміту, тож можна поспіль.
    for (const account of linked) {
      const stat = { name: account.name, imported: 0, skipped: 0 } as {
        name: string;
        imported: number;
        skipped: number;
        error?: string;
      };

      try {
        const items = await getStatement(token, account.monoAccountId!, from, to);

        const externalIds = items.map((i) => `mono:${i.id}`);
        const existing = await prisma.transaction.findMany({
          where: { externalId: { in: externalIds } },
          select: { externalId: true },
        });
        const known = new Set(existing.map((e) => e.externalId));

        const rows = items
          .filter((i) => !known.has(`mono:${i.id}`))
          .map((i) => {
            const isIncome = i.amount > 0;
            const description = [i.description, i.comment, i.counterName]
              .filter(Boolean)
              .join(" ");
            return {
              type: isIncome ? "INCOME" : "EXPENSE",
              amount: Math.abs(i.amount),
              currency: account.currency,
              date: new Date(i.time * 1000),
              note: i.description || i.comment || null,
              tags: "",
              mcc: i.mcc,
              source: "MONOBANK",
              externalId: `mono:${i.id}`,
              balanceAfter: i.balance,
              accountId: account.id,
              categoryId: resolver.resolve({
                mcc: i.mcc,
                description,
                kind: isIncome ? ("INCOME" as const) : ("EXPENSE" as const),
              }),
            };
          });

        if (rows.length > 0) {
          await prisma.transaction.createMany({ data: rows });
        }

        stat.imported = rows.length;
        stat.skipped = items.length - rows.length;
        report.imported += stat.imported;
        report.skipped += stat.skipped;
      } catch (e) {
        stat.error = e instanceof Error ? e.message : "Помилка запиту виписки";
      }

      // 3. Баланс ставимо після імпорту — щоб він не «поплив» від нарахувань.
      const mono = monoBalances.get(account.monoAccountId!);
      if (mono) {
        await prisma.account.update({
          where: { id: account.id },
          data: { balance: mono.balance },
        });
        report.balancesUpdated += 1;
      }

      report.accounts.push(stat);
    }

    const hadErrors = report.accounts.some((a) => a.error);
    await prisma.setting.update({
      where: { id: "singleton" },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: hadErrors ? "ERROR" : "OK",
        lastSyncError: hadErrors ? report.accounts.find((a) => a.error)?.error : null,
      },
    });

    return ok(report);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Помилка синхронізації";
    await prisma.setting.update({
      where: { id: "singleton" },
      data: { lastSyncAt: new Date(), lastSyncStatus: "ERROR", lastSyncError: message },
    });
    if (e instanceof MonobankError) return fail(e.message, e.status);
    return fail(message, 500);
  }
}
