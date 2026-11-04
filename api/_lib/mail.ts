/**
 * Надсилання листів.
 *
 * Поштовий провайдер необов'язковий. Без RESEND_API_KEY застосунок
 * повністю працездатний — недоступне лише відновлення пароля листом,
 * і про це чесно повідомляється в інтерфейсі, а не вдається, що лист
 * пішов у нікуди.
 */

export interface DeliveryResult {
  sent: boolean;
  /** Причина, чому лист не пішов; null — доставку налаштовано. */
  reason: string | null;
}

export async function sendPasswordReset(email: string, token: string): Promise<DeliveryResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      sent: false,
      reason:
        'Надсилання листів не налаштоване (RESEND_API_KEY). Пароль можна змінити у «Профіль → Зміна пароля».',
    };
  }

  const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
  const link = `${appUrl.replace(/\/$/, '')}/reset?token=${encodeURIComponent(token)}`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.MAIL_FROM ?? 'Finance <onboarding@resend.dev>',
        to: [email],
        subject: 'Відновлення пароля',
        text: [
          'Ви запросили відновлення пароля.',
          '',
          `Посилання дійсне одну годину: ${link}`,
          '',
          'Якщо це були не ви — просто проігноруйте цей лист.',
        ].join('\n'),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return { sent: false, reason: `Поштовий сервіс відповів ${response.status}: ${body.slice(0, 200)}` };
    }

    return { sent: true, reason: null };
  } catch (error) {
    return {
      sent: false,
      reason: `Не вдалося звернутися до поштового сервісу: ${
        error instanceof Error ? error.message : 'мережева помилка'
      }`,
    };
  }
}
