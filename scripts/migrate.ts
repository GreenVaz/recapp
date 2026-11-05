import { getDb } from '../api/_lib/db/pg.js';
import { runMigrations } from '../api/_lib/db/migrate.js';

/**
 * Ручний запуск міграцій: `npm run db:migrate`.
 *
 * У звичайній роботі він не потрібен — API застосовує міграції сам при
 * першому запиті. Скрипт корисний, щоб підготувати базу заздалегідь або
 * перевірити підключення перед розгортанням.
 */

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL не заданий. Скопіюйте .env.example у .env і вкажіть рядок підключення.');
  process.exit(1);
}

const db = getDb();

try {
  const applied = await runMigrations(db, (message) => console.log(message));
  console.log(
    applied.length === 0
      ? 'База вже актуальна — нових міграцій немає.'
      : `Застосовано міграцій: ${applied.length} (${applied.join(', ')})`,
  );
} catch (error) {
  console.error('Міграції не застосовано:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.close();
}
