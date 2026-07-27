import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handle, fail } from "@/lib/api";
import { accountUpdateSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(async () => {
    const data = accountUpdateSchema.parse(await req.json());
    return prisma.account.update({ where: { id }, data });
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const count = await prisma.transaction.count({
    where: { OR: [{ accountId: id }, { toAccountId: id }] },
  });

  // Видалення каскадом знесло б історію — пропонуємо архівувати замість цього.
  if (count > 0 && req.nextUrl.searchParams.get("force") !== "true") {
    return fail(
      `На рахунку ${count} транзакцій. Заархівуйте його або повторіть із ?force=true, щоб видалити разом з історією.`,
      409,
    );
  }

  return handle(async () => {
    await prisma.account.delete({ where: { id } });
    return { ok: true };
  });
}
