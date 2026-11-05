import { defineConfig } from 'vitest/config';

// Testy backendu (Node). Komponenty Angulara nie mają testów jednostkowych.
export default defineConfig({
  test: {
    include: ['src/backend/**/*.test.ts'],
    environment: 'node',
  },
});
