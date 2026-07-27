import crypto from "node:crypto";

/**
 * Токен Monobank і API-ключ ніколи не лежать у БД відкритим текстом.
 * Формат запису: iv:tag:ciphertext (усе hex).
 */

const ALGO = "aes-256-gcm";

function key(): Buffer {
  const secret = process.env.APP_SECRET;
  if (!secret) {
    throw new Error(
      "APP_SECRET не заданий. Додайте його в .env (openssl rand -hex 32).",
    );
  }
  // Нормалізуємо секрет будь-якої довжини до 32 байтів.
  return crypto.createHash("sha256").update(secret).digest();
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decrypt(payload: string): string | null {
  try {
    const [ivHex, tagHex, dataHex] = payload.split(":");
    if (!ivHex || !tagHex || !dataHex) return null;
    const decipher = crypto.createDecipheriv(ALGO, key(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export function generateApiKey(): string {
  return `pft_${crypto.randomBytes(24).toString("base64url")}`;
}

/** Порівняння, стійке до timing-атак. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
