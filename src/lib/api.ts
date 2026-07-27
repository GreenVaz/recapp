import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ error: message, details }, { status });
}

/** Уніфікована обгортка: ZodError → 422, решта → 500 із текстом помилки. */
export async function handle<T>(fn: () => Promise<T>) {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof ZodError) {
      return fail("Помилка валідації", 422, e.flatten());
    }
    const message = e instanceof Error ? e.message : "Невідома помилка";
    console.error("[api]", e);
    return fail(message, 500);
  }
}
