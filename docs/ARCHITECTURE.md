# Personal Finance Tracker — Архітектура

## 1. Технічний стек

| Шар | Технологія | Чому |
| --- | --- | --- |
| Frontend | Next.js 16 (App Router) + React 19 + TypeScript | SSR для дашборду, серверні компоненти читають БД напряму — без зайвого API-шару |
| Стилі | Tailwind CSS 3 | мінімалістична світла тема, дизайн-токени в `tailwind.config.ts` |
| Графіки | Recharts | декларативні SVG-чарти, легко темізуються |
| Іконки | lucide-react | тонкі лінійні іконки в дусі мінімалізму |
| Backend | Next.js Route Handlers | один деплой, спільні типи з фронтом |
| БД | SQLite через Prisma ORM | нульова конфігурація локально; міграція на PostgreSQL = зміна `provider` |
| Валідація | Zod | єдина схема для API і форм |

## 2. Модель даних

### 2.1 Ключові рішення

**Гроші зберігаються в мінорних одиницях (копійки/центи) як `Int`.**
Ніяких `Float` — це виключає помилки округлення. Monobank віддає суми
саме в мінорних одиницях, тож конвертація не потрібна.

**Сума транзакції завжди додатна.** Напрямок руху грошей визначає поле
`type` (`EXPENSE` / `INCOME` / `TRANSFER`). Це спрощує агрегації —
не треба скрізь писати `ABS()`.

**Баланс рахунку — денормалізоване поле `Account.balance`.**
Перерахунок із усієї історії транзакцій занадто дорогий, а для
Monobank-рахунків баланс і так приходить з API як джерело істини.
Для ручних рахунків баланс оновлюється транзакційно (`$transaction`)
разом зі створенням/зміною/видаленням операції.

**SQLite не підтримує enum у Prisma** — усі перелічувані типи є `String`,
а допустимі значення зафіксовані в `src/lib/constants.ts` як
TypeScript union-типи.

### 2.2 Сутності

```
Setting            (singleton, id = "singleton")
├─ baseCurrency          валюта звітності (UAH за замовчуванням)
├─ monobankToken         AES-256-GCM ciphertext
├─ monobankTokenHint     останні 4 символи для UI
├─ apiKey                ключ для iOS Shortcuts (ciphertext)
├─ lastSyncAt            індикатор останньої синхронізації
└─ lastSyncStatus/Error  результат останньої синхронізації

Account
├─ name, type            CASH | CARD | SAVINGS | JAR | OTHER
├─ currency              UAH | USD | EUR
├─ balance               Int, мінорні одиниці
├─ color, isArchived
├─ monoAccountId ?       unique — зв'язок із Monobank
├─ monoMaskedPan ?       "537541******1234"
└─ monoType ?            black | white | platinum | fop | jar …

Category                 дворівнева, self-relation
├─ name, kind            EXPENSE | INCOME
├─ parentId ?            NULL = батьківська категорія
├─ icon                  ім'я іконки lucide
├─ color                 hex для графіків
└─ sortOrder

MccRule                  MCC → категорія (авто-категоризація Monobank)
├─ mcc (unique Int)
└─ categoryId

KeywordRule              підрядок в описі → категорія
├─ pattern (lowercase), priority
└─ categoryId

Transaction
├─ type                  EXPENSE | INCOME | TRANSFER
├─ accountId             джерело (для TRANSFER — звідки)
├─ toAccountId ?         призначення (тільки TRANSFER)
├─ categoryId ?          NULL для TRANSFER
├─ amount                Int > 0, у валюті accountId
├─ toAmount ?            Int, у валюті toAccountId (крос-валютний переказ)
├─ currency              денормалізовано з рахунку
├─ date                  DateTime
├─ note, tags            tags — CSV-рядок
├─ mcc ?                 з Monobank
├─ source                MANUAL | MONOBANK | API
├─ externalId ?          unique — ідемпотентність синхронізації
└─ balanceAfter ?        з Monobank, для звірки

Budget                   unique(categoryId, month)
├─ month                 "YYYY-MM"
├─ amount                Int, у baseCurrency
└─ categoryId

RecurringPayment
├─ name, type, amount, currency
├─ accountId, categoryId
├─ frequency             WEEKLY | MONTHLY | QUARTERLY | YEARLY
├─ anchorDate            від неї рахується розклад
├─ nextDueDate           матеріалізована наступна дата
├─ reminderDays          за скільки днів нагадати
├─ autoPost              чи створювати транзакцію автоматично
└─ isActive, lastPostedAt

ExchangeRate             unique(base, quote)
├─ base, quote, rate     rate = скільки quote за 1 base
└─ updatedAt
```

### 2.3 Індекси

- `Transaction(date)`, `Transaction(accountId, date)`, `Transaction(categoryId, date)` — усі запити дашборду фільтрують за періодом.
- `Transaction(externalId)` unique — захист від дублів при повторній синхронізації.
- `Budget(categoryId, month)` unique — один бюджет на категорію на місяць.

## 3. Структура API

Усі відповіді — JSON. Помилки: `{ "error": "...", "details"?: [...] }`.

### 3.1 Внутрішні (сесія браузера)

| Метод | Шлях | Призначення |
| --- | --- | --- |
| `GET/POST` | `/api/accounts` | список / створення рахунку |
| `PATCH/DELETE` | `/api/accounts/:id` | редагування / видалення |
| `GET/POST` | `/api/categories` | дерево категорій / створення |
| `PATCH/DELETE` | `/api/categories/:id` | редагування / видалення |
| `GET/POST` | `/api/transactions` | список з фільтрами / створення |
| `PATCH/DELETE` | `/api/transactions/:id` | редагування / видалення |
| `GET/PUT` | `/api/budgets` | бюджети місяця / upsert |
| `DELETE` | `/api/budgets/:id` | видалення |
| `GET/POST` | `/api/recurring` | регулярні платежі |
| `PATCH/DELETE` | `/api/recurring/:id` | редагування / видалення |
| `POST` | `/api/recurring/:id/post` | провести платіж вручну |
| `GET/PATCH` | `/api/settings` | налаштування, базова валюта, курси |
| `POST` | `/api/settings/monobank-token` | зберегти токен (шифрується) |
| `DELETE` | `/api/settings/monobank-token` | видалити токен |
| `POST` | `/api/settings/api-key` | згенерувати ключ для Shortcuts |
| `GET` | `/api/analytics` | агрегати для всіх 6 модулів дашборду |

### 3.2 Monobank

| Метод | Шлях | Призначення |
| --- | --- | --- |
| `GET` | `/api/monobank/accounts` | `client-info`: рахунки, картки, банки |
| `POST` | `/api/monobank/link` | прив'язати mono-рахунок до локального |
| `POST` | `/api/monobank/sync` | синхронізація балансів + виписки за період |

Обмеження Monobank враховані в клієнті:
- не частіше **1 запиту на 60 секунд** — троттлінг у `src/lib/monobank.ts`;
- максимум **31 доба + 1 година** на один запит виписки — довші періоди
  автоматично розбиваються на вікна;
- `429` → зрозуміла помилка з підказкою почекати.

### 3.3 Публічний Fast-Entry API (iOS Shortcuts / Siri)

Автентифікація: заголовок `X-API-Key` **або** query-параметр `?key=`
(Shortcuts вміє і те, і те; query — щоб можна було просто відкрити URL).

```
POST /api/quick-entry
X-API-Key: <ключ із налаштувань>
Content-Type: application/json

{
  "amount": 149.50,          // у звичайних одиницях, не копійках
  "type": "EXPENSE",         // EXPENSE | INCOME | TRANSFER, за замовч. EXPENSE
  "account": "Monobank UAH", // назва або id; за замовч. — рахунок за замовчуванням
  "category": "Кава",        // назва категорії/підкатегорії, необов'язково
  "note": "Латте",
  "date": "2026-07-27",      // необов'язково, за замовч. — зараз
  "tags": "робота,кава"
}
```

`GET /api/quick-entry?key=…&amount=149.5&note=Кава` робить те саме —
для сценарію «одна кнопка на екрані блокування».

Відповідь: `{ "ok": true, "transaction": { … }, "accountBalance": … }`.

## 4. Безпека

- Токен Monobank і API-ключ шифруються **AES-256-GCM** ключем із
  `APP_SECRET` (`src/lib/crypto.ts`). У БД лежить `iv:tag:ciphertext`.
- В UI токен ніколи не повертається — тільки `monobankTokenHint`.
- API-ключ порівнюється через `crypto.timingSafeEqual`.
- Токен Monobank ніколи не потрапляє в браузер: усі запити до
  `api.monobank.ua` йдуть із серверних Route Handlers.

> **Обсяг застосунку:** це single-user застосунок для самостійного
> хостингу — окремої моделі користувачів і сесій немає. Перед публічним
> розгортанням додайте автентифікацію (наприклад Auth.js) і винесіть
> `Setting`/`Account` під `userId`.

## 5. Конвертація валют

Рахунки живуть у власних валютах. Для зведених показників
(чистий капітал, бюджети, дашборд) суми переводяться в `baseCurrency`
за таблицею `ExchangeRate`. Курси редагуються вручну в налаштуваннях
або підтягуються з `/bank/currency` Monobank (той самий ендпоінт має
власний ліміт — 1 запит на 5 хвилин, кешується).

## 6. План реалізації

| Етап | Обсяг | Статус |
| --- | --- | --- |
| 1 | Каркас проєкту, Tailwind-токени, layout, навігація | ✅ |
| 2 | Prisma-схема, сід із категоріями та MCC-правилами | ✅ |
| 3 | CRUD рахунків, мультивалютність, ручний баланс | ✅ |
| 4 | Дворівневі категорії з іконками та кольорами | ✅ |
| 5 | Транзакції: витрата / дохід / переказ + фільтри | ✅ |
| 6 | Monobank: токен, client-info, виписка, авто-категоризація | ✅ |
| 7 | Бюджети + прогрес-бари | ✅ |
| 8 | Регулярні платежі + нагадування | ✅ |
| 9 | Дашборд: 6 модулів аналітики + глобальний фільтр | ✅ |
| 10 | Fast-Entry API для iOS Shortcuts | ✅ |

## 7. Міграція на PostgreSQL

1. У `prisma/schema.prisma` замінити `provider = "sqlite"` на `"postgresql"`.
2. `DATABASE_URL="postgresql://…"` у `.env`.
3. `Transaction.tags` можна перевести на `String[]`, а рядкові
   «енуми» — на справжні `enum` Prisma.
4. `npx prisma migrate dev`.

Прикладного коду це не зачіпає — усі запити йдуть через Prisma Client.
