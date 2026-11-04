import { defineConfig, devices } from '@playwright/test';

/**
 * E2E проганяється на зібраному застосунку, а не на dev-сервері Vite:
 * перевіряти треба саме те, що поїде в продакшн.
 *
 * Сервер піднімає PostgreSQL у пам'яті, тож тести не потребують
 * зовнішньої бази і не можуть зіпсувати справжні дані.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],

  use: {
    baseURL: 'http://localhost:8787',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      // Контейнери CI зазвичай працюють від root, де пісочниця Chromium не
      // стартує, а /dev/shm замалий для вкладок.
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },

  /*
   * Пресети `devices['iPhone …']` тягнуть за собою WebKit, якого в
   * контейнері немає. Беремо з них лише розмір екрана й мобільні ознаки,
   * а рушій лишаємо Chromium.
   */
  projects: [
    {
      // Найвужчий поширений екран. Якщо верстка тримається тут — тримається скрізь.
      name: 'iphone-se',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 320, height: 568 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'iphone-pro-max',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 430, height: 932 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],

  webServer: {
    command: 'npm run build && npx tsx server/dev-server.ts',
    url: 'http://localhost:8787',
    reuseExistingServer: true,
    timeout: 180_000,
    env: { API_PORT: '8787' },
  },
});
