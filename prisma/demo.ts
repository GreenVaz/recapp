/**
 * Демонстраційні дані за останні 6 місяців — щоб дашборд було на чому подивитися.
 * Запуск: npm run db:demo    Очистити: npm run db:demo -- --reset
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SPEND_PROFILE: Array<{ category: string; notes: string[]; min: number; max: number; perMonth: number }> = [
  { category: "Супермаркети", notes: ["Сільпо", "АТБ", "Novus", "Варус"], min: 180, max: 1400, perMonth: 12 },
  { category: "Кава", notes: ["Aroma Kava", "Lviv Croissants", "One Love"], min: 45, max: 160, perMonth: 14 },
  { category: "Ресторани", notes: ["Вечеря", "Обід із командою", "Сімейний обід"], min: 350, max: 1800, perMonth: 4 },
  { category: "Доставка їжі", notes: ["Glovo", "Bolt Food"], min: 200, max: 700, perMonth: 5 },
  { category: "Таксі", notes: ["Uklon", "Bolt"], min: 80, max: 320, perMonth: 9 },
  { category: "Паливо", notes: ["WOG", "OKKO"], min: 700, max: 2200, perMonth: 2 },
  { category: "Громадський транспорт", notes: ["Метро", "Проїзний"], min: 20, max: 280, perMonth: 6 },
  { category: "Оренда", notes: ["Оренда квартири"], min: 16000, max: 16000, perMonth: 1 },
  { category: "Комунальні послуги", notes: ["Комуналка"], min: 1400, max: 3800, perMonth: 1 },
  { category: "Інтернет і зв'язок", notes: ["Київстар", "Ланет"], min: 200, max: 500, perMonth: 2 },
  { category: "Підписки", notes: ["Netflix", "Spotify", "iCloud", "YouTube Premium"], min: 90, max: 400, perMonth: 4 },
  { category: "Аптеки", notes: ["Аптека Подорожник", "Аптека АНЦ"], min: 120, max: 900, perMonth: 2 },
  { category: "Спорт", notes: ["Sport Life"], min: 800, max: 1200, perMonth: 1 },
  { category: "Одяг і взуття", notes: ["Zara", "Intertop"], min: 600, max: 4200, perMonth: 1 },
  { category: "Електроніка", notes: ["Rozetka", "Comfy"], min: 500, max: 9000, perMonth: 1 },
  { category: "Маркетплейси", notes: ["OLX", "Prom.ua"], min: 150, max: 1500, perMonth: 2 },
  { category: "Благодійність", notes: ["Повернись живим", "Притула"], min: 200, max: 1500, perMonth: 2 },
  { category: "Курси", notes: ["Udemy", "Coursera"], min: 400, max: 2500, perMonth: 1 },
];

const rand = (min: number, max: number) => Math.random() * (max - min) + min;
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

async function reset() {
  await prisma.transaction.deleteMany({});
  await prisma.budget.deleteMany({});
  await prisma.recurringPayment.deleteMany({});
  await prisma.account.updateMany({ data: { balance: 0 } });
  console.log("Демо-дані очищено.");
}

async function main() {
  if (process.argv.includes("--reset")) {
    await reset();
    return;
  }

  const accounts = await prisma.account.findMany({ where: { isArchived: false } });
  const card = accounts.find((a) => a.currency === "UAH" && a.type === "CARD") ?? accounts[0];
  const cash = accounts.find((a) => a.type === "CASH") ?? card;
  const jar = accounts.find((a) => a.currency === "USD");

  if (!card) throw new Error("Спершу створіть рахунки: npm run db:seed");

  const categories = await prisma.category.findMany();
  const byName = new Map(categories.map((c) => [c.name, c]));

  const now = new Date();
  const rows: Array<{
    type: string; amount: number; currency: string; date: Date; note: string;
    accountId: string; toAccountId?: string | null; toAmount?: number | null; categoryId: string | null;
    tags: string; source: string;
  }> = [];

  // 6 місяців історії, поточний місяць — до сьогоднішнього дня.
  for (let monthsAgo = 5; monthsAgo >= 0; monthsAgo--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
    const daysInMonth =
      monthsAgo === 0 ? now.getDate() : new Date(now.getFullYear(), now.getMonth() - monthsAgo + 1, 0).getDate();

    // Зарплата 5-го і аванс 20-го числа.
    for (const [day, base, label] of [
      [5, 48000, "Зарплата"],
      [20, 22000, "Аванс"],
    ] as const) {
      if (day > daysInMonth) continue;
      rows.push({
        type: "INCOME",
        amount: Math.round(base * rand(0.97, 1.06) * 100),
        currency: card.currency,
        date: new Date(monthStart.getFullYear(), monthStart.getMonth(), day, 10, 0),
        note: label,
        accountId: card.id,
        categoryId: byName.get(label === "Зарплата" ? "Зарплата" : "Зарплата")?.id ?? null,
        tags: "",
        source: "MANUAL",
      });
    }

    // Нерегулярний фріланс.
    if (Math.random() > 0.45) {
      rows.push({
        type: "INCOME",
        amount: Math.round(rand(6000, 26000) * 100),
        currency: card.currency,
        date: new Date(monthStart.getFullYear(), monthStart.getMonth(), Math.min(Math.ceil(rand(8, 26)), daysInMonth)),
        note: "Upwork",
        accountId: card.id,
        categoryId: byName.get("Фріланс")?.id ?? null,
        tags: "фріланс",
        source: "MANUAL",
      });
    }

    for (const profile of SPEND_PROFILE) {
      const category = byName.get(profile.category);
      const count = Math.round(profile.perMonth * rand(0.7, 1.3));

      for (let i = 0; i < count; i++) {
        const day = Math.min(Math.ceil(rand(1, daysInMonth)), daysInMonth);
        // Дрібні витрати частіше готівкою, великі — карткою.
        const amount = Math.round(rand(profile.min, profile.max) * 100);
        const account = amount < 30000 && Math.random() > 0.7 ? cash : card;

        rows.push({
          type: "EXPENSE",
          amount,
          currency: account.currency,
          date: new Date(monthStart.getFullYear(), monthStart.getMonth(), day, Math.floor(rand(8, 22))),
          note: pick(profile.notes),
          accountId: account.id,
          categoryId: category?.id ?? null,
          tags: "",
          source: Math.random() > 0.6 ? "MONOBANK" : "MANUAL",
        });
      }
    }

    // Щомісячне відкладання у валютну банку.
    if (jar && Math.random() > 0.3) {
      const uah = Math.round(rand(4000, 12000) * 100);
      rows.push({
        type: "TRANSFER",
        amount: uah,
        toAmount: Math.round((uah / 41.5 / 100) * 100),
        currency: card.currency,
        date: new Date(monthStart.getFullYear(), monthStart.getMonth(), Math.min(24, daysInMonth)),
        note: "Відкладаю в банку",
        accountId: card.id,
        toAccountId: jar.id,
        categoryId: null,
        tags: "заощадження",
        source: "MANUAL",
      });
    }
  }

  await prisma.transaction.createMany({ data: rows });

  // Баланси = сума впливів усіх операцій.
  const deltas = new Map<string, number>();
  const bump = (id: string, d: number) => deltas.set(id, (deltas.get(id) ?? 0) + d);
  for (const r of rows) {
    if (r.type === "INCOME") bump(r.accountId, r.amount);
    else if (r.type === "EXPENSE") bump(r.accountId, -r.amount);
    else {
      bump(r.accountId, -r.amount);
      if (r.toAccountId) bump(r.toAccountId, r.toAmount ?? r.amount);
    }
  }
  for (const [accountId, delta] of deltas) {
    await prisma.account.update({ where: { id: accountId }, data: { balance: { increment: delta } } });
  }

  // Бюджети на поточний і минулий місяць.
  const budgetPlan: Array<[string, number]> = [
    ["Продукти та побут", 14000],
    ["Кафе та ресторани", 8000],
    ["Транспорт", 5000],
    ["Житло", 22000],
    ["Здоров'я", 3000],
    ["Покупки", 6000],
    ["Розваги", 3500],
  ];
  for (const offset of [0, 1]) {
    const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    for (const [name, amount] of budgetPlan) {
      const category = byName.get(name);
      if (!category) continue;
      await prisma.budget.upsert({
        where: { categoryId_month: { categoryId: category.id, month } },
        update: { amount: amount * 100 },
        create: { categoryId: category.id, month, amount: amount * 100 },
      });
    }
  }

  // Регулярні платежі з різними станами нагадувань.
  const recurring = [
    { name: "Оренда квартири", amount: 16000, day: 1, category: "Оренда", frequency: "MONTHLY", reminderDays: 5 },
    { name: "Netflix", amount: 279, day: 12, category: "Підписки", frequency: "MONTHLY", reminderDays: 3 },
    { name: "Spotify", amount: 165, day: 18, category: "Підписки", frequency: "MONTHLY", reminderDays: 3 },
    { name: "Спортзал", amount: 950, day: 8, category: "Спорт", frequency: "MONTHLY", reminderDays: 4 },
    { name: "Страхування авто", amount: 7400, day: 15, category: "Страхування", frequency: "YEARLY", reminderDays: 14 },
  ];

  for (const r of recurring) {
    const exists = await prisma.recurringPayment.findFirst({ where: { name: r.name } });
    if (exists) continue;

    const anchor = new Date(now.getFullYear(), now.getMonth(), r.day, 9, 0);
    const next = anchor > now ? anchor : new Date(now.getFullYear(), now.getMonth() + 1, r.day, 9, 0);

    await prisma.recurringPayment.create({
      data: {
        name: r.name,
        type: "EXPENSE",
        amount: r.amount * 100,
        currency: card.currency,
        frequency: r.frequency,
        anchorDate: anchor,
        nextDueDate: next,
        reminderDays: r.reminderDays,
        accountId: card.id,
        categoryId: byName.get(r.category)?.id ?? null,
      },
    });
  }

  console.log(`Демо-дані створено: ${rows.length} транзакцій за 6 місяців, бюджети та регулярні платежі.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
