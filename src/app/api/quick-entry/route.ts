import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { fail, ok } from "@/lib/api";
import { getApiKey, getSettings } from "@/lib/settings";
import { safeEqual } from "@/lib/crypto";
import { quickEntrySchema } from "@/lib/validation";
import { createTransaction } from "@/lib/transactions";
import { findCategoryByName } from "@/lib/categorize";
import { formatMoney } from "@/lib/money";

/**
 * Fast-Entry для iOS Shortcuts / Siri.
 *
 * POST /api/quick-entry           (JSON або form-data, ключ у X-API-Key)
 * GET  /api/quick-entry?key=…&amount=…   (щоб працювало як звичайне посилання)
 */

async function authorize(req: NextRequest): Promise<boolean> {
  const stored = await getApiKey();
  if (!stored) return false;
  const provided = req.headers.get("x-api-key") ?? req.nextUrl.searchParams.get("key") ?? "";
  return Boolean(provided) && safeEqual(provided, stored);
}

/** Рахунок за назвою, за id, або дефолтний із налаштувань. */
async function resolveAccount(hint?: string) {
  if (hint) {
    const byId = await prisma.account.findUnique({ where: { id: hint } });
    if (byId) return byId;

    const accounts = await prisma.account.findMany({ where: { isArchived: false } });
    const lower = hint.toLowerCase();
    const match =
      accounts.find((a) => a.name.toLowerCase() === lower) ??
      accounts.find((a) => a.name.toLowerCase().includes(lower));
    if (match) return match;
  }

  const settings = await getSettings();
  if (settings.defaultAccountId) {
    const def = await prisma.account.findUnique({ where: { id: settings.defaultAccountId } });
    if (def) return def;
  }
  return prisma.account.findFirst({
    where: { isArchived: false },
    orderBy: { sortOrder: "asc" },
  });
}

async function process(req: NextRequest, raw: Record<string, unknown>) {
  const parsed = quickEntrySchema.safeParse(raw);
  if (!parsed.success) {
    return fail("Помилка валідації", 422, parsed.error.flatten());
  }
  const data = parsed.data;

  const account = await resolveAccount(data.account);
  if (!account) return fail("Не знайдено жодного рахунку. Створіть рахунок у застосунку.", 400);

  let toAccount = null;
  if (data.type === "TRANSFER") {
    toAccount = await resolveAccount(data.toAccount);
    if (!toAccount || toAccount.id === account.id) {
      return fail("Для переказу вкажіть інший рахунок призначення (toAccount)", 400);
    }
  }

  let categoryId: string | null = null;
  if (data.type !== "TRANSFER" && data.category) {
    const found = await findCategoryByName(data.category, data.type);
    categoryId = found?.id ?? null;
  }

  const date = data.date ? new Date(data.date) : new Date();
  if (Number.isNaN(date.getTime())) return fail("Некоректна дата", 422);

  const tx = await createTransaction({
    type: data.type,
    amount: data.amount,
    date,
    accountId: account.id,
    toAccountId: toAccount?.id ?? null,
    // Крос-валютний переказ без явної суми зарахування не проходить —
    // для Shortcuts беремо суму 1:1, це найпередбачуваніша поведінка.
    toAmount: toAccount && toAccount.currency !== account.currency ? data.amount : null,
    categoryId,
    note: data.note ?? null,
    tags: data.tags ?? "",
    source: "API",
  });

  const updated = await prisma.account.findUnique({ where: { id: account.id } });

  return ok({
    ok: true,
    // Рядок, готовий до озвучення Siri або показу в нотифікації Shortcuts.
    message: `${data.type === "INCOME" ? "Дохід" : data.type === "TRANSFER" ? "Переказ" : "Витрата"} ${formatMoney(data.amount, account.currency)} — ${account.name}`,
    transaction: {
      id: tx.id,
      type: tx.type,
      amount: tx.amount,
      currency: tx.currency,
      date: tx.date,
      note: tx.note,
      categoryId: tx.categoryId,
    },
    accountBalance: updated?.balance ?? null,
    accountBalanceFormatted: formatMoney(updated?.balance ?? 0, account.currency),
  });
}

export async function POST(req: NextRequest) {
  if (!(await authorize(req))) return fail("Недійсний API-ключ", 401);

  const contentType = req.headers.get("content-type") ?? "";
  let raw: Record<string, unknown>;

  if (contentType.includes("application/json")) {
    raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  } else {
    // Shortcuts легко шле form-urlencoded — приймаємо і це.
    const form = await req.formData().catch(() => null);
    raw = form ? Object.fromEntries(form.entries()) : {};
  }

  // Query-параметри доповнюють тіло — зручно для гібридних сценаріїв.
  for (const [k, v] of req.nextUrl.searchParams.entries()) {
    if (k !== "key" && raw[k] === undefined) raw[k] = v;
  }

  return process(req, raw);
}

export async function GET(req: NextRequest) {
  if (!(await authorize(req))) return fail("Недійсний API-ключ", 401);

  const raw: Record<string, unknown> = {};
  for (const [k, v] of req.nextUrl.searchParams.entries()) {
    if (k !== "key") raw[k] = v;
  }
  return process(req, raw);
}
