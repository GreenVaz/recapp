import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handle } from "@/lib/api";
import { transactionSchema } from "@/lib/validation";
import { createTransaction } from "@/lib/transactions";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const take = Math.min(Number(sp.get("limit") ?? 100), 500);
  const skip = Number(sp.get("offset") ?? 0);

  const where: Prisma.TransactionWhereInput = {};

  const from = sp.get("from");
  const to = sp.get("to");
  if (from || to) {
    where.date = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to ? { lte: new Date(to) } : {}),
    };
  }

  const accountId = sp.get("accountId");
  if (accountId) where.OR = [{ accountId }, { toAccountId: accountId }];

  const categoryId = sp.get("categoryId");
  if (categoryId) {
    const children = await prisma.category.findMany({
      where: { parentId: categoryId },
      select: { id: true },
    });
    where.categoryId = { in: [categoryId, ...children.map((c) => c.id)] };
  }

  const type = sp.get("type");
  if (type) where.type = type;

  const q = sp.get("q");
  if (q) where.note = { contains: q };

  return handle(async () => {
    const [items, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take,
        skip,
        include: {
          account: { select: { id: true, name: true, currency: true, color: true } },
          toAccount: { select: { id: true, name: true, currency: true } },
          category: { select: { id: true, name: true, icon: true, color: true, parentId: true } },
        },
      }),
      prisma.transaction.count({ where }),
    ]);
    return { items, total, take, skip };
  });
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const data = transactionSchema.parse(await req.json());
    return createTransaction({
      ...data,
      date: new Date(data.date),
      toAmount: data.toAmount ?? null,
    });
  });
}
