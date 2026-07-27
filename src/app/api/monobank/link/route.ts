import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handle } from "@/lib/api";
import { CURRENCIES } from "@/lib/constants";

const schema = z.object({
  monoAccountId: z.string().min(1),
  /** Або прив'язати до наявного рахунку, або створити новий із цими даними. */
  localAccountId: z.string().nullable().optional(),
  name: z.string().trim().min(1).max(60).optional(),
  currency: z.enum(CURRENCIES).optional(),
  type: z.string().optional(),
  maskedPan: z.string().nullable().optional(),
  balance: z.number().int().optional(),
});

export async function POST(req: NextRequest) {
  return handle(async () => {
    const data = schema.parse(await req.json());

    // Один mono-рахунок = один локальний. Знімаємо стару прив'язку, якщо була.
    const conflicting = await prisma.account.findUnique({
      where: { monoAccountId: data.monoAccountId },
    });
    if (conflicting && conflicting.id !== data.localAccountId) {
      await prisma.account.update({
        where: { id: conflicting.id },
        data: { monoAccountId: null, monoMaskedPan: null, monoType: null },
      });
    }

    if (data.localAccountId) {
      return prisma.account.update({
        where: { id: data.localAccountId },
        data: {
          monoAccountId: data.monoAccountId,
          monoMaskedPan: data.maskedPan ?? null,
          monoType: data.type ?? null,
          ...(data.balance !== undefined ? { balance: data.balance } : {}),
        },
      });
    }

    const count = await prisma.account.count();
    return prisma.account.create({
      data: {
        name: data.name ?? "Monobank",
        type: data.type === "jar" ? "JAR" : "CARD",
        currency: data.currency ?? "UAH",
        balance: data.balance ?? 0,
        color: "#1c1c1a",
        sortOrder: count,
        monoAccountId: data.monoAccountId,
        monoMaskedPan: data.maskedPan ?? null,
        monoType: data.type ?? null,
      },
    });
  });
}

/** Відв'язати mono-рахунок від локального. */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("localAccountId");
  return handle(async () => {
    if (!id) throw new Error("Не вказано localAccountId");
    return prisma.account.update({
      where: { id },
      data: { monoAccountId: null, monoMaskedPan: null, monoType: null },
    });
  });
}
