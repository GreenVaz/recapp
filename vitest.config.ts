import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@core': path.resolve(import.meta.dirname, 'src/core'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // PGlite стартує WASM-екземпляр PostgreSQL — це довше за звичайний unit-тест.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: 'forks',
  },
});
