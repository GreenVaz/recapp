"use client";

/** Тонка обгортка над fetch: розгортає {error} у виняток із текстом для UI. */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const details = data?.details?.fieldErrors as Record<string, string[]> | undefined;
    const firstField = details && Object.values(details).flat()[0];
    throw new Error(firstField ?? data?.error ?? `Помилка ${res.status}`);
  }
  return data as T;
}

export const post = <T>(url: string, body: unknown) =>
  api<T>(url, { method: "POST", body: JSON.stringify(body) });

export const patch = <T>(url: string, body: unknown) =>
  api<T>(url, { method: "PATCH", body: JSON.stringify(body) });

export const put = <T>(url: string, body: unknown) =>
  api<T>(url, { method: "PUT", body: JSON.stringify(body) });

export const del = <T>(url: string) => api<T>(url, { method: "DELETE" });
