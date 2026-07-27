import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handle } from "@/lib/api";
import { categoryUpdateSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(async () => {
    const data = categoryUpdateSchema.parse(await req.json());

    if (data.parentId) {
      if (data.parentId === id) throw new Error("Категорія не може бути власним батьком");
      const parent = await prisma.category.findUnique({ where: { id: data.parentId } });
      if (parent?.parentId) throw new Error("Підтримується лише два рівні вкладеності");

      const hasChildren = await prisma.category.count({ where: { parentId: id } });
      if (hasChildren > 0) throw new Error("Спершу перенесіть підкатегорії");
    }

    return prisma.category.update({ where: { id }, data });
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(async () => {
    // Транзакції не видаляємо — вони лишаються з categoryId = NULL (onDelete: SetNull).
    await prisma.category.delete({ where: { id } });
    return { ok: true };
  });
}
