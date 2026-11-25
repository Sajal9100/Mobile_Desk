import { defineConfig } from 'prisma/config';
import { z } from 'zod';

// Local development convenience: load .env if present. Never in production, where the
// environment is injected by the secrets manager.
if (process.env['NODE_ENV'] !== 'production') {
  try {
    process.loadEnvFile('.env');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

// Only DATABASE_URL is validated here, so `prisma migrate` does not need the whole app config.
// When it is unset the datasource is omitted: `prisma generate` (Docker/CI builds) still works,
// while migrate/introspection commands fail with Prisma's own "datasource.url" error.
const rawUrl = process.env['DATABASE_URL'];
const databaseUrl =
  rawUrl === undefined
    ? undefined
    : z
        .url()
        .refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol))
        .parse(rawUrl);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  ...(databaseUrl === undefined ? {} : { datasource: { url: databaseUrl } }),
});
