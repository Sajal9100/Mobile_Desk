import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Writable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { Logger } from 'pino';
import { AppModule } from '../../../src/app.module.js';
import { configureHttpApp, createFastifyAdapter } from '../../../src/bootstrap.js';
import { setRuntimeConfig } from '../../../src/common/config/config.service.js';
import { parseConfig } from '../../../src/common/config/load-config.js';
import { PrismaService } from '../../../src/common/database/prisma.service.js';
import { createLogger } from '../../../src/common/logger.js';
import { LOGGER, getRootLogger } from '../../../src/common/logger.module.js';
import { RedisService } from '../../../src/common/redis/redis.service.js';
import {
  PLAY_INTEGRITY_CLIENT,
  type PlayIntegrityClient,
} from '../../../src/modules/integrity/play-integrity.client.js';
import { enforceEnv, jwtEnv, type Ed25519Pair } from '../../helpers/test-config.js';
import { TestClient } from './client.js';

// Needs Docker. Every test file starts its own Postgres 16 + Redis 7 so that one file cannot
// affect another. Within a file, tests use unique emails and a fresh source IP per request.

export const REDIS_PASSWORD = 'test-redis-password';
/** Long and unusual on purpose: the leak tests search the logs for it (the default, "test", is a word). */
export const POSTGRES_PASSWORD = 'test-postgres-password-8f2c41';

export type Stack = {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  app: NestFastifyApplication;
  prisma: PrismaService;
  /** The same Redis client the application uses (for assertions and for simulating expiry). */
  redisClient: RedisService['client'];
  client: TestClient;
  /** The JWT key pair the server signs with (the public half lets a test verify independently). */
  jwtKeys: Ed25519Pair;
  kid: string;
  /** Everything logged so far, one JSON line per entry, when a capturing logger is in use. */
  logText: () => string;
};

export type StackOptions = {
  /** Configuration overrides on top of a valid test environment. */
  env?: Record<string, string>;
  /** Run in `enforce` mode with the Google client replaced by this mock. */
  integrityClient?: PlayIntegrityClient;
  /** Capture every log line at trace level (for the "never logged" assertions). */
  captureLogs?: boolean;
};

/** Applies prisma/migrations with the real Prisma CLI, exactly as `npm run prisma:deploy` does. */
export function migrate(databaseUrl: string): void {
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

export function createCapturingLogger(): { logger: Logger; text: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    logger: createLogger({ level: 'trace', service: 'test' }, stream),
    text: () => chunks.join(''),
  };
}

export async function startStack(options: StackOptions = {}): Promise<Stack> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:16').withPassword(POSTGRES_PASSWORD).start(),
    new RedisContainer('redis:7').withPassword(REDIS_PASSWORD).start(),
  ]);

  migrate(postgres.getConnectionUri());

  const jwt = jwtEnv('integration-key');
  const parsed = parseConfig({
    NODE_ENV: 'test',
    PORT_API: '3000',
    PORT_REALTIME: '3001',
    DATABASE_URL: postgres.getConnectionUri(),
    REDIS_URL: redis.getConnectionUrl(),
    LOG_LEVEL: 'silent',
    APP_PUBLIC_BASE_URL: 'http://localhost:3000',
    INTEGRITY_MODE: 'bypass',
    ...jwt.env,
    ...(options.integrityClient === undefined ? {} : enforceEnv()),
    ...options.env,
  });
  if (!parsed.ok)
    throw new Error(`test configuration is invalid: ${JSON.stringify(parsed.issues)}`);
  setRuntimeConfig(parsed.config);

  const capture = options.captureLogs === true ? createCapturingLogger() : undefined;
  const logger = capture?.logger ?? getRootLogger('test');

  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LOGGER)
    .useValue(logger);
  if (options.integrityClient !== undefined) {
    builder = builder.overrideProvider(PLAY_INTEGRITY_CLIENT).useValue(options.integrityClient);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createFastifyAdapter(logger, { trustProxy: parsed.config.TRUST_PROXY }),
  );
  configureHttpApp(app, parsed.config, logger);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    postgres,
    redis,
    app,
    prisma: app.get(PrismaService),
    redisClient: app.get(RedisService).client,
    client: new TestClient(app),
    jwtKeys: jwt.pair,
    kid: 'integration-key',
    logText: () => capture?.text() ?? '',
  };
}

export async function stopStack(stack: Stack | undefined): Promise<void> {
  if (stack === undefined) return;
  await stack.app.close();
  await Promise.allSettled([stack.postgres.stop(), stack.redis.stop()]);
}

/** Polls until `check` returns a value that satisfies `done` (a stopped container needs a moment). */
export async function waitFor<T>(
  check: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await check();
  while (!done(last) && Date.now() < deadline) {
    await delay(250);
    last = await check();
  }
  return last;
}
