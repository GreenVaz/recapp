import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Межі імпортів, які неможливо перевірити ні типами, ні звичайними тестами.
 *
 * Обидва правила тут мають одну спільну рису: порушення не видно ні
 * локально, ні в тестах, бо Vite й Vitest розв'язують і псевдоніми, і
 * розширення самі. Vercel не робить ні того, ні іншого — він компілює
 * файл у .js і лишає специфікатор як написано. Тому помилка спливає
 * щойно в продакшні, у вигляді ERR_MODULE_NOT_FOUND на кожному запиті.
 *
 * Обидва випадки вже ламали живий застосунок. Цей файл — щоб не втретє.
 */

const ROOT = new URL('..', import.meta.url).pathname;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts') || full.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const IMPORT_RE = /\bfrom\s+'([^']+)'/g;

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(IMPORT_RE)].map((m) => m[1]!);
}

describe('межі імпортів', () => {
  const apiFiles = walk(join(ROOT, 'api'));
  const coreFiles = walk(join(ROOT, 'src', 'core'));

  it('знаходить файли, які перевіряє', () => {
    expect(apiFiles.length).toBeGreaterThan(5);
    expect(coreFiles.length).toBeGreaterThan(3);
  });

  it('у api/ немає псевдонімів шляхів — Vercel їх не розв’язує', () => {
    const offenders: string[] = [];
    for (const file of apiFiles) {
      for (const specifier of importsOf(file)) {
        if (specifier.startsWith('@core/') || specifier.startsWith('@/')) {
          offenders.push(`${file.replace(ROOT, '')} → ${specifier}`);
        }
      }
    }
    // Правильно — відносний шлях: '../../src/core/money.js'
    expect(offenders).toEqual([]);
  });

  it('локальні імпорти пишуться з .js, а не .ts', () => {
    const offenders: string[] = [];
    for (const file of [...apiFiles, ...coreFiles]) {
      for (const specifier of importsOf(file)) {
        if (specifier.startsWith('.') && specifier.endsWith('.ts')) {
          offenders.push(`${file.replace(ROOT, '')} → ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('src/core/ не залежить ні від чого в проєкті', () => {
    const offenders: string[] = [];
    for (const file of coreFiles) {
      for (const specifier of importsOf(file)) {
        const isRelativeWithinCore = specifier.startsWith('./');
        const isNodeBuiltin = specifier.startsWith('node:');
        if (!isRelativeWithinCore && !isNodeBuiltin) {
          offenders.push(`${file.replace(ROOT, '')} → ${specifier}`);
        }
      }
    }
    // Саме це робить фінансову логіку однаковою на клієнті й сервері.
    expect(offenders).toEqual([]);
  });
});
