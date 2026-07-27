import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handle } from "@/lib/api";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(async () => {
    await prisma.budget.delete({ where: { id } });
    return { ok: true };
  });
}
