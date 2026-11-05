import * as m0001 from './0001_init.js';

/**
 * Реєстр міграцій у порядку застосування.
 *
 * Новий файл додається імпортом і новим елементом у кінці масиву.
 * Наявні міграції не редагуються — вони вже застосовані в боєвих базах.
 */
export interface Migration {
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [{ name: m0001.name, sql: m0001.sql }];
