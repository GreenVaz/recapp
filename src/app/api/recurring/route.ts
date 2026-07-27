import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handle } from "@/lib/api";
import { recurringSchema } from "@/lib/validation";
import { nextDueDate } from "@/lib/recurring";

export async function GET() {
  return handle(async () =>
    prisma.recurringPayment.findMany({
      orderBy: [{ isActive: "desc" }, { nextDueDate: "asc" }],
      include: {
        account: { select: { id: true, name: true, currency: true } },
        category: { select: { id: true, name: true, icon: true, color: true } },
      },
    }),
  );
}

export async function POST(req: NextRequest) {
  return handle(async () => {
    const data = recurringSchema.parse(await req.json());
    const anchor = new Date(data.anchorDate);

    // Якщо якір у минулому — одразу підтягуємо найближчу майбутню дату.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const due = anchor > yesterday ? anchor : nextDueDate(anchor, data.frequency, yesterday);

    return prisma.recurringPayment.create({
      data: { ...data, anchorDate: anchor, nextDueDate: due },
    });
  });
}
