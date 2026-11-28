import { defineConfig } from 'vitest/config';

// Unit tests: no network, no containers. Integration tests (Docker, built server) use
// vitest.integration.config.ts; they are told apart by the ".integration.spec.ts" suffix.
export default defineConfig({
  test: {
    root: './',
    include: ['test/unit/**/*.spec.ts', 'test/security/**/*.spec.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.spec.ts'],
    environment: 'node',
  },
});
