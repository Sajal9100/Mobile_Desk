import { defineConfig } from 'vitest/config';

// Unit tests: no network, no containers. Integration tests use vitest.integration.config.ts.
export default defineConfig({
  test: {
    root: './',
    include: ['test/unit/**/*.spec.ts', 'test/security/**/*.spec.ts'],
    environment: 'node',
  },
});
