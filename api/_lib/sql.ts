import { badRequest } from './http.js';

/**
 * Складає UPDATE із набору змінених полів.
 *
 * Імена колонок — літерали з коду маршруту, ніколи не з запиту
 * користувача; значення завжди йдуть параметрами. Тому конкатенація тут
 * безпечна, і це єдине місце, де вона взагалі відбувається.
 */
export function buildUpdate(
  table: string,
  columns: Record<string, unknown>,
  idParam = '$1',
): { text: string; values: unknown[] } {
  const keys = Object.keys(columns);
  if (keys.length === 0) throw badRequest('Немає змін');

  const assignments = keys.map((key, i) => `${key} = $${i + 2}`).join(', ');
  return {
    text: `update ${table} set ${assignments}, updated_at = now() where id = ${idParam} returning *`,
    values: keys.map((key) => columns[key]),
  };
}

/** Прибирає undefined, лишаючи явні null (вони означають «очистити поле»). */
export function defined<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
