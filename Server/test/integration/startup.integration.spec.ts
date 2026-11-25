import { afterAll, describe, expect, it } from 'vitest';
import {
  getFreePort,
  runToExit,
  startServer,
  startWorker,
  type Entry,
  type RunningServer,
  type RunningWorker,
} from './helpers/server-process.js';

const SECRET_DB_PASSWORD = 'SENTINEL_DB_PASSWORD_91';
const SECRET_REDIS_PASSWORD = 'SENTINEL_REDIS_PASSWORD_42';

const entries: Entry[] = ['main-api.js', 'main-realtime.js', 'main-worker.js'];

describe('startup refuses bad configuration (real process)', () => {
  it.each(entries)(
    '%s exits non-zero when DATABASE_URL is missing, printing no values',
    (entry) => {
      const { exitCode, output } = runToExit(entry, {
        NODE_ENV: 'development',
        PORT_API: '3000',
        PORT_REALTIME: '3001',
        // DATABASE_URL deliberately absent
        REDIS_URL: `redis://:${SECRET_REDIS_PASSWORD}@127.0.0.1:6379/0`,
        APP_PUBLIC_BASE_URL: 'NOT_A_URL_SENTINEL_77',
      });

      expect(exitCode).not.toBe(0);
      expect(exitCode).not.toBeNull();
      expect(output).toContain('DATABASE_URL: missing');
      expect(output).toContain('APP_PUBLIC_BASE_URL');
      expect(output).not.toContain(SECRET_REDIS_PASSWORD);
      expect(output).not.toContain('NOT_A_URL_SENTINEL_77');
    },
  );

  it('refuses an empty environment', () => {
    const { exitCode, output } = runToExit('main-api.js', {});
    expect(exitCode).not.toBe(0);
    expect(output).toContain('NODE_ENV: missing');
  });
});

const deadDependencies = (port: number): Record<string, string> => ({
  NODE_ENV: 'development',
  PORT_API: String(port),
  PORT_REALTIME: String(port),
  DATABASE_URL: `postgresql://app:${SECRET_DB_PASSWORD}@127.0.0.1:1/app`,
  REDIS_URL: `redis://:${SECRET_REDIS_PASSWORD}@127.0.0.1:1/0`,
  APP_PUBLIC_BASE_URL: `http://localhost:${port}`,
  LOG_LEVEL: 'info',
});

describe.each(['main-api.js', 'main-realtime.js'] as const)(
  '%s with unreachable Postgres and Redis (real process, fail closed)',
  (entry) => {
    let server: RunningServer | undefined;
    afterAll(async () => {
      await server?.stop();
    });

    it('is alive on /health, not ready on /ready, and never logs secrets', async () => {
      const port = await getFreePort();
      server = await startServer(entry, deadDependencies(port), port);

      const health = await fetch(`${server.baseUrl}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: 'ok' });

      const started = Date.now();
      const ready = await fetch(`${server.baseUrl}/ready`);
      const body = (await ready.json()) as { error: { code: string; requestId: string } };
      expect(ready.status).toBe(503);
      expect(body.error.code).toBe('service_unavailable');
      expect(ready.headers.get('x-request-id')).toBe(body.error.requestId);
      expect(Date.now() - started).toBeLessThan(2_500); // each dependency is limited to 1 s

      const unknown = await fetch(`${server.baseUrl}/api/nope?ticket=QUERY_SECRET_SENTINEL`);
      expect(unknown.status).toBe(404);

      const logs = server.output();
      expect(logs).toContain('"msg":"listening"');
      expect(logs).not.toContain(SECRET_DB_PASSWORD);
      expect(logs).not.toContain(SECRET_REDIS_PASSWORD);
      expect(logs).not.toContain('QUERY_SECRET_SENTINEL');
    });
  },
);

describe('worker with unreachable Postgres and Redis (real process)', () => {
  let worker: RunningWorker | undefined;
  afterAll(async () => {
    await worker?.stop();
  });

  it('starts, stays alive, and never logs secrets', async () => {
    // The worker never listens, but the shared config still requires valid port numbers.
    worker = await startWorker(deadDependencies(3000));
    await new Promise((resolve) => setTimeout(resolve, 1_500)); // not a one-shot: it must keep running
    expect(worker.isRunning()).toBe(true);
    expect(worker.output()).not.toContain(SECRET_DB_PASSWORD);
    expect(worker.output()).not.toContain(SECRET_REDIS_PASSWORD);
  });
});
