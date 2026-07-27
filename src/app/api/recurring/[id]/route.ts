import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handle } from "@/lib/api";
import { recurringUpdateSchema } from "@/lib/validation";
import { nextDueDate } from "@/lib/recurring";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(async () => {
    const data = recurringUpdateSchema.parse(await req.json());
    const existing = await prisma.recurringPayment.findUnique({ where: { id } });
    if (!existing) throw new Error("Платіж не знайдено");

    const anchor = data.anchorDate ? new Date(data.anchorDate) : existing.anchorDate;
    const frequency = data.frequency ?? existing.frequency;

    // Зміна якоря або періодичності робить стару nextDueDate недійсною.
    const scheduleChanged = Boolean(data.anchorDate) || Boolean(data.frequency);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    return prisma.recurringPayment.update({
      where: { id },
      data: {
        ...data,
        anchorDate: anchor,
        nextDueDate: scheduleChanged
          ? anchor > yesterday
            ? anchor
            : nextDueDate(anchor, frequency, yesterday)
          : existing.nextDueDate,
      },
    });
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  return handle(async () => {
    await prisma.recurringPayment.delete({ where: { id } });
    return { ok: true };
  });
}
