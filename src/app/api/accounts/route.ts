import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handle } from "@/lib/api";
import { accountSchema } from "@/lib/validation";

export async function GET() {
  return handle(async () =>
    prisma.account.findMany({
      orderBy: [{ isArchived: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { transactions: true } } },
    }),
  );
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const data = accountSchema.parse(await req.json());
    const count = await prisma.account.count();
    return prisma.account.create({ data: { ...data, sortOrder: count } });
  });
}
