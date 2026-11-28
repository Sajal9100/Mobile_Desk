import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../src/app.module.js';
import { configureHttpApp, createFastifyAdapter } from '../../src/bootstrap.js';
import { setRuntimeConfig } from '../../src/common/config/config.service.js';
import { parseConfig } from '../../src/common/config/load-config.js';
import { PrismaService } from '../../src/common/database/prisma.service.js';
import { getRootLogger } from '../../src/common/logger.module.js';
import { jwtEnv } from '../helpers/test-config.js';

// Needs Docker. Each describe block gets its own Postgres 16 + Redis 7 so one scenario cannot
// affect another.

const REDIS_PASSWORD = 'test-redis-password';

type Stack = {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  app: NestFastifyApplication;
};

/** Applies prisma/migrations with the real Prisma CLI, exactly as `npm run prisma:deploy` does. */
function migrate(databaseUrl: string): void {
  const prismaCli = join(
    dirname(createRequire(import.meta.url).resolve('prisma/package.json')),
    'build',
    'index.js',
  );
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
}

async function startStack(): Promise<Stack> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:16').start(),
    new RedisContainer('redis:7').withPassword(REDIS_PASSWORD).start(),
  ]);

  migrate(postgres.getConnectionUri());

  const parsed = parseConfig({
    NODE_ENV: 'test',
    PORT_API: '3000',
    PORT_REALTIME: '3001',
    DATABASE_URL: postgres.getConnectionUri(),
    REDIS_URL: redis.getConnectionUrl(),
    LOG_LEVEL: 'silent',
    APP_PUBLIC_BASE_URL: 'http://localhost:3000',
    INTEGRITY_MODE: 'bypass',
    ...jwtEnv().env,
  });
  if (!parsed.ok) throw new Error('test configuration is invalid');
  setRuntimeConfig(parsed.config);

  const logger = getRootLogger('test');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(logger));
  configureHttpApp(app, parsed.config, logger);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { postgres, redis, app };
}

async function stopStack(stack: Stack | undefined): Promise<void> {
  if (stack === undefined) return;
  await stack.app.close();
  await Promise.allSettled([stack.postgres.stop(), stack.redis.stop()]);
}

async function ready(app: NestFastifyApplication) {
  const res = await app.inject({ method: 'GET', url: '/ready' });
  return { status: res.statusCode, body: res.json<Record<string, unknown>>() };
}

/** Polls /ready until it returns `status` (a stopped container needs a moment to be noticed). */
async function waitForStatus(app: NestFastifyApplication, status: number, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let last = await ready(app);
  while (last.status !== status && Date.now() < deadline) {
    await delay(250);
    last = await ready(app);
  }
  return last;
}

describe('GET /health and /ready with real Postgres and Redis', () => {
  let stack: Stack | undefined;
  beforeAll(async () => {
    stack = await startStack();
  });
  afterAll(async () => {
    await stopStack(stack);
  });

  it('/health is 200', async () => {
    const res = await stack?.app.inject({ method: 'GET', url: '/health' });
    expect(res?.statusCode).toBe(200);
    expect(res?.json()).toEqual({ status: 'ok' });
  });

  it('/ready is 200 when both dependencies are up', async () => {
    const result = await ready(stack!.app);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
  });

  it('the init migration created app_meta', async () => {
    const prisma = stack!.app.get(PrismaService);
    const rows = await prisma.$queryRaw<{ name: string | null }[]>`
      SELECT to_regclass('public.app_meta')::text AS name`;
    expect(rows[0]?.name).toBe('app_meta');
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
