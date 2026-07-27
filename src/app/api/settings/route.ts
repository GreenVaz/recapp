import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { handle } from "@/lib/api";
import { settingsSchema } from "@/lib/validation";
import { getPublicSettings } from "@/lib/settings";

export async function GET() {
  return handle(async () => {
    const [settings, rates] = await Promise.all([
      getPublicSettings(),
      prisma.exchangeRate.findMany({ orderBy: { base: "asc" } }),
    ]);
    return { ...settings, rates };
  });
}

export async function PATCH(req: NextRequest) {
  return handle(async () => {
    const { rates, ...rest } = settingsSchema.parse(await req.json());

    if (Object.keys(rest).length > 0) {
      await prisma.setting.update({ where: { id: "singleton" }, data: rest });
    }

    for (const r of rates ?? []) {
      await prisma.exchangeRate.upsert({
        where: { base_quote: { base: r.base, quote: r.quote } },
        update: { rate: r.rate },
        create: r,
      });
    }

    return getPublicSettings();
  });
}
