import { prisma } from "./prisma";

export interface CategoryResolver {
  resolve(input: { mcc?: number | null; description?: string | null; kind: "EXPENSE" | "INCOME" }): string | null;
}

/**
 * Правила категоризації читаються з БД один раз на синхронізацію,
 * далі мапінг іде в пам'яті — інакше на 500 транзакцій буде 1000 запитів.
 *
 * Порядок: ключове слово в описі (специфічніше) → MCC-код → fallback.
 */
export async function buildCategoryResolver(): Promise<CategoryResolver> {
  const [mccRules, keywordRules, fallback] = await Promise.all([
    prisma.mccRule.findMany({ select: { mcc: true, categoryId: true } }),
    prisma.keywordRule.findMany({
      select: { pattern: true, categoryId: true, priority: true },
      orderBy: { priority: "desc" },
    }),
    prisma.category.findFirst({ where: { name: "Без категорії" }, select: { id: true } }),
  ]);

  const mccMap = new Map(mccRules.map((r) => [r.mcc, r.categoryId]));

  return {
    resolve({ mcc, description }) {
      const text = (description ?? "").toLowerCase();
      if (text) {
        for (const rule of keywordRules) {
          if (text.includes(rule.pattern)) return rule.categoryId;
        }
      }
      if (mcc != null) {
        const byMcc = mccMap.get(mcc);
        if (byMcc) return byMcc;
      }
      return fallback?.id ?? null;
    },
  };
}

/** Пошук категорії за назвою — для Fast-Entry API, де приходить текст. */
export async function findCategoryByName(name: string, kind: "EXPENSE" | "INCOME") {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const all = await prisma.category.findMany({
    where: { kind },
    select: { id: true, name: true, parentId: true },
  });

  const lower = trimmed.toLowerCase();
  // Підкатегорії пріоритетніші — вони конкретніші за батьківські.
  const exact =
    all.find((c) => c.parentId && c.name.toLowerCase() === lower) ??
    all.find((c) => c.name.toLowerCase() === lower);
  if (exact) return exact;

  return (
    all.find((c) => c.parentId && c.name.toLowerCase().includes(lower)) ??
    all.find((c) => c.name.toLowerCase().includes(lower)) ??
    null
  );
}
