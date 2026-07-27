import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handle } from "@/lib/api";
import { budgetSchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month") ?? undefined;
  return handle(async () =>
    prisma.budget.findMany({
      where: month ? { month } : undefined,
      include: { category: { select: { id: true, name: true, icon: true, color: true, parentId: true } } },
      orderBy: { amount: "desc" },
    }),
  );
}

/** PUT, бо це upsert: один бюджет на пару (категорія, місяць). */
export async function PUT(req: NextRequest) {
  return handle(async () => {
    const data = budgetSchema.parse(await req.json());

    if (data.amount <= 0) {
      await prisma.budget
        .delete({ where: { categoryId_month: { categoryId: data.categoryId, month: data.month } } })
        .catch(() => undefined);
      return { deleted: true };
    }

    return prisma.budget.upsert({
      where: { categoryId_month: { categoryId: data.categoryId, month: data.month } },
      update: { amount: data.amount },
      create: data,
    });
  });
}
