import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handle } from "@/lib/api";
import { categorySchema } from "@/lib/validation";

export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get("kind");
  return handle(async () =>
    prisma.category.findMany({
      where: kind ? { kind } : undefined,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { transactions: true, children: true } } },
    }),
  );
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const data = categorySchema.parse(await req.json());

    // Дворівнева система: підкатегорія не може мати власних дітей.
    if (data.parentId) {
      const parent = await prisma.category.findUnique({ where: { id: data.parentId } });
      if (!parent) throw new Error("Батьківську категорію не знайдено");
      if (parent.parentId) throw new Error("Підтримується лише два рівні вкладеності");
    }

    const siblings = await prisma.category.count({
      where: { parentId: data.parentId ?? null, kind: data.kind },
    });
    return prisma.category.create({ data: { ...data, sortOrder: siblings } });
  });
}
