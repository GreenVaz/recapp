import { prisma } from "@/lib/prisma";
import { handle } from "@/lib/api";
import { encrypt, generateApiKey } from "@/lib/crypto";
import { getApiKey } from "@/lib/settings";

/** Ключ показується у відповіді — його треба скопіювати в Shortcuts. */
export async function POST() {
  return handle(async () => {
    const key = generateApiKey();
    await prisma.setting.update({ where: { id: "singleton" }, data: { apiKey: encrypt(key) } });
    return { key };
  });
}

export async function GET() {
  return handle(async () => ({ key: await getApiKey() }));
}

export async function DELETE() {
  return handle(async () => {
    await prisma.setting.update({ where: { id: "singleton" }, data: { apiKey: null } });
    return { ok: true };
  });
}
