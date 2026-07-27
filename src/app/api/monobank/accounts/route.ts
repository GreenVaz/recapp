import { prisma } from "@/lib/prisma";
import { fail, ok } from "@/lib/api";
import { getMonobankToken } from "@/lib/settings";
import { getClientInfo, MonobankError, monoAccountTitle } from "@/lib/monobank";
import { CURRENCY_BY_NUMERIC } from "@/lib/constants";

export async function GET() {
  const token = await getMonobankToken();
  if (!token) return fail("Токен Monobank не налаштований", 400);

  try {
    const info = await getClientInfo(token);
    const linked = await prisma.account.findMany({
      where: { monoAccountId: { not: null } },
      select: { id: true, name: true, monoAccountId: true },
    });
    const linkedBy = new Map(linked.map((a) => [a.monoAccountId!, a]));

    const accounts = info.accounts.map((a) => {
      const currency = CURRENCY_BY_NUMERIC[a.currencyCode] ?? String(a.currencyCode);
      return {
        id: a.id,
        title: monoAccountTitle(a, currency),
        type: a.type,
        currency,
        balance: a.balance,
        creditLimit: a.creditLimit,
        maskedPan: a.maskedPan?.[0] ?? null,
        iban: a.iban,
        linkedTo: linkedBy.get(a.id) ?? null,
      };
    });

    const jars = (info.jars ?? []).map((j) => {
      const currency = CURRENCY_BY_NUMERIC[j.currencyCode] ?? String(j.currencyCode);
      return {
        id: j.id,
        title: `Банка: ${j.title}`,
        type: "jar",
        currency,
        balance: j.balance,
        goal: j.goal ?? null,
        maskedPan: null,
        iban: null,
        linkedTo: linkedBy.get(j.id) ?? null,
      };
    });

    return ok({ clientName: info.name, accounts: [...accounts, ...jars] });
  } catch (e) {
    if (e instanceof MonobankError) return fail(e.message, e.status);
    return fail(e instanceof Error ? e.message : "Помилка Monobank", 500);
  }
}
