import { createServer } from 'node:http';
import { nodeHandler } from '../api/_lib/node-adapter.ts';

/**
 * Локальний API-сервер для `npm run dev`.
 * Vite проксює на нього /api, тож фронтенд працює так само, як у проді.
 */

const port = Number(process.env.API_PORT ?? 8787);

const server = createServer((req, res) => {
  void nodeHandler(req, res).catch((error) => {
    console.error('[dev-server]', error);
    if (!res.headersSent) res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Внутрішня помилка' }));
  });
});

server.listen(port, () => {
  console.log(`API слухає http://localhost:${port}`);
  if (!process.env.DATABASE_URL) {
    console.warn('⚠ DATABASE_URL не заданий — запити до БД впадуть. Скопіюйте .env.example у .env');
  }
});
