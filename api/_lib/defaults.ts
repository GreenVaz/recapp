/**
 * Стартовий набір категорій і рахунок за замовчуванням.
 * Створюється один раз при реєстрації — далі користувач редагує все сам.
 */

export interface SeedCategory {
  name: string;
  icon: string;
  color: string;
  children?: Array<{ name: string; icon: string }>;
}

export const EXPENSE_CATEGORIES: SeedCategory[] = [
  {
    name: 'Продукти',
    icon: 'ShoppingBasket',
    color: '#3f8f6b',
    children: [
      { name: 'Супермаркети', icon: 'ShoppingCart' },
      { name: 'Ринок', icon: 'Apple' },
      { name: 'Побутова хімія', icon: 'SprayCan' },
    ],
  },
  {
    name: 'Кафе та ресторани',
    icon: 'UtensilsCrossed',
    color: '#d08a2e',
    children: [
      { name: 'Ресторани', icon: 'Utensils' },
      { name: 'Кава', icon: 'Coffee' },
      { name: 'Доставка їжі', icon: 'Bike' },
    ],
  },
  {
    name: 'Транспорт',
    icon: 'TramFront',
    color: '#4a7fd6',
    children: [
      { name: 'Таксі', icon: 'CarTaxiFront' },
      { name: 'Громадський транспорт', icon: 'BusFront' },
      { name: 'Квитки', icon: 'TicketsPlane' },
    ],
  },
  {
    name: 'Авто',
    icon: 'Car',
    color: '#5b6bc0',
    children: [
      { name: 'Паливо', icon: 'Fuel' },
      { name: 'Обслуговування', icon: 'Wrench' },
      { name: 'Страхування', icon: 'ShieldCheck' },
      { name: 'Паркування і штрафи', icon: 'CircleParking' },
    ],
  },
  {
    name: 'Житло',
    icon: 'Home',
    color: '#9b6bbf',
    children: [
      { name: 'Оренда', icon: 'KeyRound' },
      { name: 'Ремонт', icon: 'Hammer' },
      { name: 'Меблі та техніка', icon: 'Lamp' },
    ],
  },
  {
    name: 'Комунальні',
    icon: 'Plug',
    color: '#6b8fbf',
    children: [
      { name: 'Електрика', icon: 'Zap' },
      { name: 'Газ і опалення', icon: 'Flame' },
      { name: 'Вода', icon: 'Droplets' },
      { name: 'Інтернет і зв’язок', icon: 'Wifi' },
    ],
  },
  {
    name: 'Підписки',
    icon: 'Repeat',
    color: '#c06bb0',
    children: [
      { name: 'Стримінг', icon: 'Clapperboard' },
      { name: 'Музика', icon: 'Music' },
      { name: 'Сервіси та хмара', icon: 'Cloud' },
    ],
  },
  {
    name: 'Покупки',
    icon: 'ShoppingBag',
    color: '#c0834a',
    children: [
      { name: 'Одяг і взуття', icon: 'Shirt' },
      { name: 'Електроніка', icon: 'Smartphone' },
      { name: 'Подарунки', icon: 'Gift' },
    ],
  },
  {
    name: "Здоров'я",
    icon: 'HeartPulse',
    color: '#d05b5b',
    children: [
      { name: 'Аптека', icon: 'Pill' },
      { name: 'Лікарі', icon: 'Stethoscope' },
      { name: 'Спорт', icon: 'Dumbbell' },
    ],
  },
  {
    name: 'Розваги',
    icon: 'Sparkles',
    color: '#8f6bd6',
    children: [
      { name: 'Кіно і театр', icon: 'Film' },
      { name: 'Хобі', icon: 'Palette' },
      { name: 'Подорожі', icon: 'Plane' },
    ],
  },
  {
    name: 'Освіта',
    icon: 'GraduationCap',
    color: '#4a9f9b',
    children: [
      { name: 'Курси', icon: 'BookOpen' },
      { name: 'Книги', icon: 'Book' },
    ],
  },
  {
    name: 'Кредити',
    icon: 'Landmark',
    color: '#d07a3f',
    children: [
      { name: 'Платежі по кредитах', icon: 'CreditCard' },
      { name: 'Відсотки та комісії', icon: 'Receipt' },
    ],
  },
  { name: 'Інше', icon: 'CircleEllipsis', color: '#8b8f9a' },
];

export const INCOME_CATEGORIES: SeedCategory[] = [
  {
    name: 'Зарплата',
    icon: 'Wallet',
    color: '#3f9f6b',
    children: [
      { name: 'Основна частина', icon: 'Banknote' },
      { name: 'Премія', icon: 'Award' },
    ],
  },
  { name: 'Аванс', icon: 'CalendarClock', color: '#4a9f8b' },
  {
    name: 'Підробіток',
    icon: 'Laptop',
    color: '#5b9f4a',
    children: [
      { name: 'Фріланс', icon: 'Code' },
      { name: 'Разові роботи', icon: 'Hammer' },
    ],
  },
  { name: 'Бізнес', icon: 'Briefcase', color: '#4a8fbf' },
  { name: 'Повернення коштів', icon: 'Undo2', color: '#8b8f9a' },
  { name: 'Інше', icon: 'Inbox', color: '#8b8f9a' },
];

export const DEFAULT_RATES = [
  { base: 'USD', quote: 'UAH', rate: 41.5 },
  { base: 'EUR', quote: 'UAH', rate: 45 },
];
