import { defineConfig } from 'vitest/config';

// Testy backendu i czystej logiki frontu (Node). Komponenty Angulara nie mają testów jednostkowych.
export default defineConfig({
  test: {
    include: ['src/backend/**/*.test.ts', 'src/app/**/*.test.ts'],
    environment: 'node',
  },
});
