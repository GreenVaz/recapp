import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handle } from "@/lib/api";
import { encrypt } from "@/lib/crypto";

const schema = z.object({ token: z.string().trim().min(20, "Токен виглядає закоротким") });

export async function POST(req: NextRequest) {
  return handle(async () => {
    const { token } = schema.parse(await req.json());
    await prisma.setting.update({
      where: { id: "singleton" },
      data: {
        monobankToken: encrypt(token),
        monobankTokenHint: token.slice(-4),
        lastSyncStatus: null,
        lastSyncError: null,
      },
    });
    return { ok: true, hint: token.slice(-4) };
  });
}

export async function DELETE() {
  return handle(async () => {
    await prisma.setting.update({
      where: { id: "singleton" },
      data: { monobankToken: null, monobankTokenHint: null, lastSyncAt: null, lastSyncStatus: null, lastSyncError: null },
    });
    return { ok: true };
  });
}
