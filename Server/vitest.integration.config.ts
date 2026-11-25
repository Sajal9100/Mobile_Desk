import { defineConfig } from 'vitest/config';

// Integration tests start real Postgres/Redis with Testcontainers (Docker required) and some
// spawn the built server (`dist/`), which `npm run test:integration` builds first.
export default defineConfig({
  test: {
    root: './',
    include: ['test/integration/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 240_000,
    fileParallelism: false,
  },
});
