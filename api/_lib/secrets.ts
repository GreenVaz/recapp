/**
 * Шифрування чужих секретів, які застосунок мусить зберігати, —
 * насамперед токена доступу до банку.
 *
 * Пароль можна тримати хешем, бо його досить звіряти. Токен банку треба
 * саме відновлювати, щоб ходити з ним в API, тож потрібне зворотне
 * шифрування, а не хеш.
 *
 * AES-GCM на Web Crypto, без залежностей — як і решта криптографії в
 * проєкті. Ключ виводиться з AUTH_SECRET через HKDF з окремим `info`:
 * той самий секрет не можна використовувати і для підпису сесій, і для
 * шифрування даних, інакше компрометація одного застосування тягне друге.
 *
 * Наслідок, про який треба памʼятати: зміна AUTH_SECRET робить збережені
 * токени нечитабельними. Це не втрата даних — банк просто треба підключити
 * заново, — але користувачеві слід сказати про це чесно.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const IV_BYTES = 12;

/**
 * Копія, підперта саме ArrayBuffer.
 *
 * `TextEncoder.encode` дає `Uint8Array<ArrayBufferLike>`, а Web Crypto
 * вимагає `ArrayBuffer` — SharedArrayBuffer туди не можна. Копіювання
 * задовольняє типи й нічого не коштує на таких розмірах.
 */
function bytes(text: string): Uint8Array<ArrayBuffer> {
  const encoded = encoder.encode(text);
  const copy = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  copy.set(encoded);
  return copy;
}

const INFO = bytes('recapp:bank-token:v1');

function secret(): Uint8Array<ArrayBuffer> {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 16) {
    throw new Error('AUTH_SECRET не заданий або закороткий — шифрувати токен нічим');
  }
  return bytes(value);
}

let cached: Promise<CryptoKey> | undefined;

function aesKey(): Promise<CryptoKey> {
  cached ??= (async () => {
    const material = await crypto.subtle.importKey('raw', secret(), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(new ArrayBuffer(0)), info: INFO },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  })();
  return cached;
}

/** Повертає base64url(iv ‖ шифротекст). */
export async function encryptSecret(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await aesKey(),
    bytes(plain),
  );
  const packed = new Uint8Array(iv.length + sealed.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(sealed), iv.length);
  return Buffer.from(packed).toString('base64url');
}

/**
 * Розшифровує те, що повернув `encryptSecret`.
 *
 * Кидає, якщо шифротекст пошкоджений або ключ інший — мовчки повертати
 * порожній рядок не можна, бо виклик до банку тоді піде без токена й
 * помилка спливе далеко від причини.
 */
export async function decryptSecret(packed: string): Promise<string> {
  const bytes = new Uint8Array(Buffer.from(packed, 'base64url'));
  if (bytes.length <= IV_BYTES) throw new Error('Пошкоджений шифротекст');

  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(0, IV_BYTES) },
    await aesKey(),
    bytes.subarray(IV_BYTES),
  );
  return decoder.decode(plain);
}

/** Секрет у шляху вебхука: банк стукає сюди, сесії в нього немає. */
export function generateWebhookSecret(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
}

/** Лише останні цифри — щоб показати, який токен збережено, не розкриваючи його. */
export function tokenHint(token: string): string {
  return token.length <= 4 ? '••••' : `••••${token.slice(-4)}`;
}

/** Тести підставляють інший AUTH_SECRET — кеш ключа треба скинути. */
export function resetKeyCache(): void {
  cached = undefined;
}
