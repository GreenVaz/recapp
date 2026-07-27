import { prisma } from "./prisma";
import { decrypt } from "./crypto";

export async function getSettings() {
  const existing = await prisma.setting.findUnique({ where: { id: "singleton" } });
  if (existing) return existing;
  return prisma.setting.create({ data: { id: "singleton" } });
}

/** Розшифрований токен Monobank. Ніколи не віддавати в браузер. */
export async function getMonobankToken(): Promise<string | null> {
  const s = await getSettings();
  return s.monobankToken ? decrypt(s.monobankToken) : null;
}

export async function getApiKey(): Promise<string | null> {
  const s = await getSettings();
  return s.apiKey ? decrypt(s.apiKey) : null;
}

/** Форма налаштувань, безпечна для клієнта — без секретів. */
export async function getPublicSettings() {
  const s = await getSettings();
  return {
    baseCurrency: s.baseCurrency,
    hasMonobankToken: Boolean(s.monobankToken),
    monobankTokenHint: s.monobankTokenHint,
    hasApiKey: Boolean(s.apiKey),
    defaultAccountId: s.defaultAccountId,
    lastSyncAt: s.lastSyncAt,
    lastSyncStatus: s.lastSyncStatus,
    lastSyncError: s.lastSyncError,
  };
}
