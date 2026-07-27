import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Дерево категорій: батьківська → підкатегорії.
 * mcc — коди, які автоматично мапляться на цю підкатегорію при синхронізації
 * з Monobank. keywords — підрядки опису як запасний варіант, коли MCC пустий
 * або надто загальний (наприклад 4829 «грошові перекази»).
 */
const EXPENSE_TREE = [
  {
    name: "Продукти та побут",
    icon: "ShoppingCart",
    color: "#3f6f5c",
    children: [
      { name: "Супермаркети", icon: "ShoppingBasket", mcc: [5411, 5422, 5441, 5451, 5462, 5499], keywords: ["сільпо", "атб", "novus", "новус", "варус", "ашан", "метро", "фора", "таврія"] },
      { name: "Побутова хімія", icon: "SprayCan", mcc: [5122, 5912, 5977], keywords: ["watsons", "єва", "prostor", "простор"] },
      { name: "Алкоголь і тютюн", icon: "Wine", mcc: [5921, 5993] },
    ],
  },
  {
    name: "Кафе та ресторани",
    icon: "UtensilsCrossed",
    color: "#c08a2e",
    children: [
      { name: "Ресторани", icon: "Utensils", mcc: [5812, 5813] },
      { name: "Фастфуд", icon: "Sandwich", mcc: [5814], keywords: ["mcdonald", "kfc", "домінос", "sushi"] },
      { name: "Кава", icon: "Coffee", keywords: ["aroma kava", "кава", "coffee", "starbucks", "lviv croissants"] },
      { name: "Доставка їжі", icon: "Bike", keywords: ["glovo", "bolt food", "raketa", "uber eats"] },
    ],
  },
  {
    name: "Транспорт",
    icon: "Car",
    color: "#4a6f9c",
    children: [
      { name: "Таксі", icon: "CarTaxiFront", mcc: [4121], keywords: ["uklon", "bolt", "uber"] },
      { name: "Громадський транспорт", icon: "TramFront", mcc: [4111, 4131, 4112] },
      { name: "Паливо", icon: "Fuel", mcc: [5541, 5542], keywords: ["wog", "okko", "укрнафта", "shell", "socar"] },
      { name: "Авто та обслуговування", icon: "Wrench", mcc: [5531, 5533, 7538, 7523] },
    ],
  },
  {
    name: "Житло",
    icon: "Home",
    color: "#8f5f8a",
    children: [
      { name: "Оренда", icon: "KeyRound", mcc: [6513] },
      { name: "Комунальні послуги", icon: "Plug", mcc: [4900], keywords: ["київенерго", "нафтогаз", "комунал", "水"] },
      { name: "Інтернет і зв'язок", icon: "Wifi", mcc: [4814, 4899], keywords: ["київстар", "vodafone", "lifecell", "ланет", "воля"] },
      { name: "Меблі та ремонт", icon: "Hammer", mcc: [5200, 5211, 5712, 5722], keywords: ["епіцентр", "нова лінія", "jysk", "ikea"] },
    ],
  },
  {
    name: "Здоров'я",
    icon: "HeartPulse",
    color: "#c2554a",
    children: [
      { name: "Аптеки", icon: "Pill", mcc: [5122, 5912], keywords: ["аптека", "подорожник", "ани", "бажаємо здоров"] },
      { name: "Лікарі та клініки", icon: "Stethoscope", mcc: [8011, 8021, 8031, 8042, 8062, 8071, 8099] },
      { name: "Спорт", icon: "Dumbbell", mcc: [7997, 7941], keywords: ["sport life", "спортлайф", "fitness"] },
    ],
  },
  {
    name: "Покупки",
    icon: "ShoppingBag",
    color: "#a2763f",
    children: [
      { name: "Одяг і взуття", icon: "Shirt", mcc: [5611, 5621, 5631, 5641, 5651, 5661, 5691, 5699] },
      { name: "Електроніка", icon: "Smartphone", mcc: [5732, 5734, 5045, 5722], keywords: ["rozetka", "розетка", "comfy", "фокстрот", "allo", "цитрус"] },
      { name: "Маркетплейси", icon: "Package", mcc: [5964, 5969, 5399], keywords: ["prom.ua", "olx", "aliexpress", "amazon"] },
      { name: "Подарунки", icon: "Gift", mcc: [5947, 5992] },
    ],
  },
  {
    name: "Розваги",
    icon: "Sparkles",
    color: "#7a5f9c",
    children: [
      { name: "Підписки", icon: "Repeat", mcc: [4899, 5815, 5816, 5817, 5818], keywords: ["netflix", "spotify", "youtube", "apple.com/bill", "megogo", "google storage", "icloud", "chatgpt", "anthropic"] },
      { name: "Кіно і театр", icon: "Clapperboard", mcc: [7832, 7922, 7929] },
      { name: "Хобі", icon: "Palette", mcc: [5945, 5942, 5940] },
      { name: "Подорожі", icon: "Plane", mcc: [3000, 4511, 4722, 7011], keywords: ["booking", "airbnb", "wizzair", "ryanair", "мау"] },
    ],
  },
  {
    name: "Освіта",
    icon: "GraduationCap",
    color: "#5c8f8a",
    children: [
      { name: "Курси", icon: "BookOpen", mcc: [8220, 8241, 8244, 8249, 8299], keywords: ["udemy", "coursera", "genius.space"] },
      { name: "Книги", icon: "Book", mcc: [5942, 5192], keywords: ["yakaboo", "книгарня"] },
    ],
  },
  {
    name: "Фінанси",
    icon: "Landmark",
    color: "#6b6f8f",
    children: [
      { name: "Комісії банку", icon: "Receipt", mcc: [6012] },
      { name: "Кредити", icon: "CreditCard", mcc: [6051, 6011] },
      { name: "Страхування", icon: "ShieldCheck", mcc: [6300, 5960] },
      { name: "Благодійність", icon: "HandHeart", mcc: [8398], keywords: ["притула", "повернись живим", "united24", "монобанк банка"] },
    ],
  },
  {
    name: "Інше",
    icon: "CircleEllipsis",
    color: "#8a8a84",
    children: [{ name: "Без категорії", icon: "CircleHelp" }],
  },
];

const INCOME_TREE = [
  {
    name: "Основний дохід",
    icon: "Briefcase",
    color: "#2f7d5f",
    children: [
      { name: "Зарплата", icon: "Wallet", keywords: ["зарплата", "salary", "аванс"] },
      { name: "Премія", icon: "Award", keywords: ["премія", "бонус"] },
    ],
  },
  {
    name: "Додатковий дохід",
    icon: "TrendingUp",
    color: "#5f8a5c",
    children: [
      { name: "Фріланс", icon: "Laptop", keywords: ["upwork", "фоп", "freelance"] },
      { name: "Продаж речей", icon: "Tag", keywords: ["olx"] },
      { name: "Кешбек", icon: "Coins", keywords: ["кешбек", "cashback"] },
    ],
  },
  {
    name: "Пасивний дохід",
    icon: "PiggyBank",
    color: "#3f6f5c",
    children: [
      { name: "Відсотки по депозиту", icon: "Percent", keywords: ["відсотк", "депозит"] },
      { name: "Інвестиції", icon: "ChartLine", keywords: ["дивіденд"] },
    ],
  },
  {
    name: "Інші надходження",
    icon: "Inbox",
    color: "#8a8a84",
    children: [
      { name: "Подарунки", icon: "Gift" },
      { name: "Повернення коштів", icon: "Undo2", keywords: ["повернення", "refund"] },
    ],
  },
];

async function seedTree(
  tree: typeof EXPENSE_TREE,
  kind: "EXPENSE" | "INCOME",
) {
  let parentOrder = 0;
  for (const parent of tree) {
    const existingParent = await prisma.category.findFirst({
      where: { name: parent.name, kind, parentId: null },
    });
    const parentRow =
      existingParent ??
      (await prisma.category.create({
        data: {
          name: parent.name,
          kind,
          icon: parent.icon,
          color: parent.color,
          sortOrder: parentOrder,
        },
      }));
    parentOrder += 1;

    let childOrder = 0;
    for (const child of parent.children) {
      const existingChild = await prisma.category.findFirst({
        where: { name: child.name, kind, parentId: parentRow.id },
      });
      const childRow =
        existingChild ??
        (await prisma.category.create({
          data: {
            name: child.name,
            kind,
            icon: child.icon,
            color: parent.color,
            parentId: parentRow.id,
            sortOrder: childOrder,
          },
        }));
      childOrder += 1;

      for (const mcc of ("mcc" in child ? child.mcc : undefined) ?? []) {
        // Перший, хто заявив MCC, той його і тримає — дублі просто пропускаємо.
        await prisma.mccRule.upsert({
          where: { mcc },
          update: {},
          create: { mcc, label: child.name, categoryId: childRow.id },
        });
      }

      for (const pattern of ("keywords" in child ? child.keywords : undefined) ?? []) {
        const exists = await prisma.keywordRule.findFirst({
          where: { pattern, categoryId: childRow.id },
        });
        if (!exists) {
          await prisma.keywordRule.create({
            data: { pattern: pattern.toLowerCase(), categoryId: childRow.id, priority: 10 },
          });
        }
      }
    }
  }
}

async function main() {
  await prisma.setting.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton", baseCurrency: "UAH" },
  });

  await seedTree(EXPENSE_TREE, "EXPENSE");
  await seedTree(INCOME_TREE as unknown as typeof EXPENSE_TREE, "INCOME");

  // Стартові курси. Редагуються в Налаштуваннях.
  const rates = [
    { base: "USD", quote: "UAH", rate: 41.5 },
    { base: "EUR", quote: "UAH", rate: 45.0 },
  ];
  for (const r of rates) {
    await prisma.exchangeRate.upsert({
      where: { base_quote: { base: r.base, quote: r.quote } },
      update: {},
      create: r,
    });
  }

  if ((await prisma.account.count()) === 0) {
    await prisma.account.createMany({
      data: [
        { name: "Готівка", type: "CASH", currency: "UAH", balance: 0, color: "#5f8a5c", sortOrder: 0 },
        { name: "Monobank UAH", type: "CARD", currency: "UAH", balance: 0, color: "#1c1c1a", sortOrder: 1 },
        { name: "Валютна банка", type: "JAR", currency: "USD", balance: 0, color: "#4a6f9c", sortOrder: 2 },
      ],
    });
  }

  const categories = await prisma.category.count();
  const mccRules = await prisma.mccRule.count();
  console.log(`Сід виконано: ${categories} категорій, ${mccRules} MCC-правил.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
