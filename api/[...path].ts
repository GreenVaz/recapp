import type { VercelRequest, VercelResponse } from '@vercel/node';
import { nodeHandler } from './_lib/node-adapter.ts';

/**
 * Єдина serverless-функція на весь API.
 *
 * Безкоштовний тариф Vercel обмежує кількість функцій на розгортання, тож
 * усі маршрути обслуговує один catch-all, а розбір шляху робить власний
 * роутер.
 */
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  await nodeHandler(req, res);
}
