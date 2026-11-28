import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { waitFor, startStack, stopStack, type Stack } from './helpers/stack.js';

// Needs Docker. Each describe block gets its own Postgres 16 + Redis 7 so one scenario cannot
// affect another.

async function ready(app: NestFastifyApplication) {
  const res = await app.inject({ method: 'GET', url: '/ready' });
  return { status: res.statusCode, body: res.json<Record<string, unknown>>() };
}

/** Polls /ready until it returns `status` (a stopped container needs a moment to be noticed). */
function waitForStatus(app: NestFastifyApplication, status: number) {
  return waitFor(
    () => ready(app),
    (result) => result.status === status,
  );
}

describe('GET /health and /ready with real Postgres and Redis', () => {
  let stack: Stack | undefined;
  beforeAll(async () => {
    stack = await startStack();
  });
  afterAll(async () => {
    await stopStack(stack);
  });

  it('/health is 200 without a token', async () => {
    const res = await stack?.app.inject({ method: 'GET', url: '/health' });
    expect(res?.statusCode).toBe(200);
    expect(res?.json()).toEqual({ status: 'ok' });
  });

  it('/ready is 200 without a token when both dependencies are up', async () => {
    const result = await ready(stack!.app);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
  });

  it('the migrations created app_meta and the Phase 2 tables', async () => {
    const rows = await stack!.prisma.$queryRaw<{ name: string }[]>`
      SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
       ORDER BY table_name`;
    expect(rows.map((row) => row.name)).toEqual([
      'app_meta',
      'refresh_tokens',
      'user_settings',
      'users',
    ]);
  });

  it('the database refuses an email that is not trimmed and lower-cased', async () => {
    const insert = (email: string) =>
      stack!.prisma.$executeRaw`
        INSERT INTO users (id, email, password_hash, display_name)
        VALUES (gen_random_uuid(), ${email}, 'x', 'Check')`;
    await expect(insert('Upper@Example.com')).rejects.toThrow();
    await expect(insert(' padded@example.com ')).rejects.toThrow();
    await expect(insert('fine@example.com')).resolves.toBe(1);
  });
});

describe('/ready when Redis is stopped', () => {
  let stack: Stack | undefined;
  beforeAll(async () => {
    stack = await startStack();
  });
  afterAll(async () => {
    await stopStack(stack);
  });

  it('returns 503 service_unavailable in the standard shape', async () => {
    expect((await ready(stack!.app)).status).toBe(200);

    await stack!.redis.stop({ remove: false });

    const result = await waitForStatus(stack!.app, 503);
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: { code: 'service_unavailable' } });
  });
});

describe('/ready when Postgres is stopped', () => {
  let stack: Stack | undefined;
  beforeAll(async () => {
    stack = await startStack();
  });
  afterAll(async () => {
    await stopStack(stack);
  });

  it('returns 503 service_unavailable', async () => {
    expect((await ready(stack!.app)).status).toBe(200);

    await stack!.postgres.stop({ remove: false });

    const result = await waitForStatus(stack!.app, 503);
    expect(result.status).toBe(503);
    expect(result.body).toMatchObject({ error: { code: 'service_unavailable' } });
  });
});
