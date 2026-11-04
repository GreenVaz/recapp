import { expect, test, type Page } from '@playwright/test';

/**
 * Сценарій приймання з технічного завдання, пройдений як людина:
 * реєстрація → рахунок → зарплата → оренда → розстрочка → календар →
 * прогноз → платіж → перевірка, що баланс змінився рівно один раз.
 */

const PASSWORD = 'correct-horse-battery';

function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`;
}

/** Поле суми приймає значення у звичайних одиницях. */
async function fillAmount(page: Page, value: string) {
  await page.getByLabel('Сума').first().fill(value);
}

async function register(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Реєстрація' }).click();
  await page.getByPlaceholder('you@example.com').fill(uniqueEmail());
  await page.getByPlaceholder('••••••••').fill(PASSWORD);
  await page.getByRole('button', { name: 'Створити акаунт' }).click();
  await expect(page.getByRole('heading', { name: 'Фінанси' })).toBeVisible();
}

test.describe('повний сценарій', () => {
  test('від реєстрації до прогнозу залишку', async ({ page }) => {
    await register(page);

    // ── Рахунок із залишком 20 000 ──
    await page.goto('/settings/accounts');
    await page.getByRole('button', { name: 'Новий рахунок' }).click();
    await page.getByPlaceholder('Картка Приват').fill('Основна картка');
    await fillAmount(page, '20000');
    await page.getByRole('button', { name: 'Зберегти' }).click();

    await expect(page.getByText('Основна картка', { exact: true })).toBeVisible();
    await expect(page.getByText('20 000 ₴').first()).toBeVisible();

    // ── Зарплата 40 000 щомісяця ──
    await page.goto('/new/recurring');
    await page.getByRole('button', { name: 'Дохід' }).click();
    await fillAmount(page, '40000');
    await page.getByPlaceholder('Назва платежу').fill('Зарплата');
    await page.getByRole('button', { name: 'Створити розклад' }).click();
    await expect(page).toHaveURL(/\/calendar/);

    // ── Оренда 15 000 щомісяця ──
    await page.goto('/new/recurring');
    await fillAmount(page, '15000');
    await page.getByPlaceholder('Назва платежу').fill('Оренда');
    await page.getByRole('button', { name: 'Створити розклад' }).click();
    await expect(page).toHaveURL(/\/calendar/);

    // ── Розстрочка 24 000 на 8 платежів ──
    await page.goto('/new/loan');
    await page.getByPlaceholder('Телефон у розстрочку').fill('Телефон');
    await fillAmount(page, '24000');
    await page.getByLabel('Кількість платежів').fill('8');

    // Попередній розрахунок має показати платіж 3 000 ₴.
    await expect(page.getByText('Попередній розрахунок')).toBeVisible();
    await expect(page.getByText('3 000 ₴').first()).toBeVisible();

    await page.getByRole('button', { name: 'Створити графік' }).click();
    await expect(page).toHaveURL(/\/loans\/[0-9a-f-]+/);
    await expect(page.getByText('Залишок основного боргу')).toBeVisible();
    await expect(page.getByText('24 000 ₴').first()).toBeVisible();

    // ── Графік має 8 рядків по 3 000 ₴ ──
    const scheduleRows = page.getByRole('button', { name: 'Сплатити' });
    await expect(scheduleRows).toHaveCount(8);

    // ── Платіж змінює баланс рівно один раз ──
    await scheduleRows.first().click();
    await expect(page.getByText('Провести платіж')).toBeVisible();
    await page.getByRole('button', { name: 'Провести платіж' }).click();

    await expect(page.getByText('21 000 ₴').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сплатити' })).toHaveCount(7);

    // Баланс рахунку зменшився на 3 000, а не на 6 000.
    await page.goto('/settings/accounts');
    await expect(page.getByText('17 000 ₴').first()).toBeVisible();
  });

  test('календар показує прогноз і деталі дня', async ({ page }) => {
    await register(page);

    await page.goto('/settings/accounts');
    await page.getByRole('button', { name: 'Новий рахунок' }).click();
    await page.getByPlaceholder('Картка Приват').fill('Картка');
    await fillAmount(page, '5000');
    await page.getByRole('button', { name: 'Зберегти' }).click();
    await expect(page.getByText('Картка', { exact: true })).toBeVisible();

    await page.goto('/new/expense');
    await fillAmount(page, '1200');
    await page.getByPlaceholder('Необов’язково').fill('Продукти на тиждень');
    await page.getByRole('button', { name: 'Зберегти' }).click();

    await page.goto('/calendar');
    await expect(page.getByRole('heading', { name: 'Календар' })).toBeVisible();

    // Клітинка сьогодні відкриває шторку з деталями.
    const todayCell = page.locator('button[aria-label*="залишок"]').filter({ hasText: /\d/ });
    await expect(todayCell.first()).toBeVisible();

    await page.getByRole('button', { name: 'Список' }).click();
    await expect(page.getByText('Продукти на тиждень')).toBeVisible();
    await page.getByText('Продукти на тиждень').click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Початок дня')).toBeVisible();
    await expect(page.getByText('Залишок на кінець')).toBeVisible();
    await expect(page.getByText('3 800 ₴').first()).toBeVisible();
  });

  test('попереджає про дефіцит', async ({ page }) => {
    await register(page);

    await page.goto('/settings/accounts');
    await page.getByRole('button', { name: 'Новий рахунок' }).click();
    await page.getByPlaceholder('Картка Приват').fill('Тонкий гаманець');
    await fillAmount(page, '1000');
    await page.getByRole('button', { name: 'Зберегти' }).click();
    await expect(page.getByText('Тонкий гаманець', { exact: true })).toBeVisible();

    // Планова витрата, більша за залишок.
    await page.goto('/new/expense');
    await fillAmount(page, '5000');
    await page.getByPlaceholder('Необов’язково').fill('Великий рахунок');
    await page.getByText('Ще не виконано').click();
    await page.getByRole('button', { name: 'Зберегти' }).click();

    await page.goto('/');
    await expect(page.getByText(/Грошей не вистачить/)).toBeVisible();
  });
});

test.describe('мобільна верстка', () => {
  test('немає горизонтального скролу на жодному екрані', async ({ page }) => {
    await register(page);

    for (const path of ['/', '/calendar', '/loans', '/analytics', '/settings', '/new/expense']) {
      await page.goto(path);
      await page.waitForTimeout(400);

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `горизонтальний скрол на ${path}`).toBeLessThanOrEqual(1);
    }
  });

  test('нижня навігація доступна і перемикає екрани', async ({ page }) => {
    await register(page);

    const nav = page.getByRole('navigation', { name: 'Основна навігація' });

    await nav.getByRole('link', { name: 'Календар' }).click();
    await expect(page.getByRole('heading', { name: 'Календар' })).toBeVisible();

    await nav.getByRole('link', { name: 'Кредити' }).click();
    await expect(page.getByRole('heading', { name: 'Кредити' })).toBeVisible();

    await nav.getByRole('link', { name: 'Аналітика' }).click();
    await expect(page.getByRole('heading', { name: 'Аналітика' })).toBeVisible();

    // Центральна кнопка відкриває меню швидких дій.
    await page.getByRole('button', { name: 'Додати операцію' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Кредит або розстрочка')).toBeVisible();
  });

  test('перемикання теми працює', async ({ page }) => {
    await register(page);
    await page.goto('/settings');

    await page.getByRole('button', { name: 'Світла', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.getByRole('button', { name: 'Темна', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('PWA', () => {
  test('маніфест і сервіс-воркер доступні', async ({ page, request }) => {
    await page.goto('/');

    const manifest = await request.get('/manifest.webmanifest');
    expect(manifest.ok()).toBe(true);

    const json = (await manifest.json()) as {
      display: string;
      icons: Array<{ sizes: string; purpose?: string }>;
      start_url: string;
    };
    expect(json.display).toBe('standalone');
    expect(json.icons.some((i) => i.sizes === '512x512')).toBe(true);
    expect(json.icons.some((i) => i.purpose === 'maskable')).toBe(true);

    const sw = await request.get('/sw.js');
    expect(sw.ok()).toBe(true);

    const appleIcon = await request.get('/icons/apple-touch-icon.png');
    expect(appleIcon.ok()).toBe(true);
  });
});
