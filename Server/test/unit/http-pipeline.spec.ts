import { Writable } from 'node:stream';
import { Body, Controller, ForbiddenException, Get, Module, Post } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BODY_LIMIT_BYTES, configureHttpApp, createFastifyAdapter } from '../../src/bootstrap.js';
import { ERROR_CODES } from '../../src/common/errors/codes.js';
import { AllExceptionsFilter } from '../../src/common/errors/all-exceptions.filter.js';
import { AppException } from '../../src/common/errors/app.exception.js';
import { createLogger } from '../../src/common/logger.js';
import { LOGGER } from '../../src/common/logger.module.js';
import { ZodValidationPipe } from '../../src/common/validation/zod-validation.pipe.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ERROR_LEAK = 'internal detail: password=hunter2 at /srv/app/secret.ts';

const sampleBody = z.strictObject({ name: z.string().min(1).max(50) });
const blobBody = z.strictObject({ blob: z.string() });

@Controller('test')
class TestController {
  @Get('boom')
  boom(): never {
    throw new Error(ERROR_LEAK);
  }

  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenException(ERROR_LEAK);
  }

  @Get('limited')
  limited(): never {
    throw AppException.rateLimited(30);
  }

  @Post('echo')
  echo(@Body(new ZodValidationPipe(sampleBody)) body: z.infer<typeof sampleBody>) {
    return { name: body.name };
  }

  @Post('blob')
  blob(@Body(new ZodValidationPipe(blobBody)) body: z.infer<typeof blobBody>) {
    return { length: body.blob.length };
  }
}

const logLines: Record<string, unknown>[] = [];
const logStream = new Writable({
  write(chunk: Buffer, _encoding, callback) {
    logLines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
    callback();
  },
});
const logger = createLogger({ level: 'info', service: 'test' }, logStream);

@Module({
  controllers: [TestController],
  providers: [
    { provide: LOGGER, useValue: logger },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
class TestAppModule {}

async function createApp(corsOrigins: string[]): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(logger));
  configureHttpApp(app, { CORS_ORIGINS: corsOrigins }, logger);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

type ErrorPayload = { error: { code: string; message: string; requestId: string } };

describe('HTTP pipeline', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    app = await createApp([]);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('error shape', () => {
    it('unknown route -> 404 not_found in the standard shape', async () => {
      const res = await app.inject({ method: 'GET', url: '/does/not/exist' });
      const body = res.json<ErrorPayload>();
      expect(res.statusCode).toBe(404);
      expect(body.error.code).toBe('not_found');
      expect(typeof body.error.message).toBe('string');
      expect(res.body).not.toContain('/does/not/exist'); // fixed message: no echo of the route
    });

    it('thrown generic Error -> 500 internal_error with no stack and no internal detail', async () => {
      const res = await app.inject({ method: 'GET', url: '/test/boom' });
      const body = res.json<ErrorPayload>();
      expect(res.statusCode).toBe(500);
      expect(body.error.code).toBe('internal_error');
      expect(Object.keys(body.error).sort()).toEqual(['code', 'message', 'requestId']);
      expect(res.body).not.toMatch(/stack|\bat \S+:\d+|hunter2|secret\.ts|internal detail/i);
      // ...but the full error is available to operators in the log.
      const logged = logLines.find((line) => line['msg'] === 'unhandled error');
      expect(logged).toBeDefined();
      expect(JSON.stringify(logged)).toContain('internal detail');
    });

    it('framework HttpException -> mapped code with a fixed message', async () => {
      const res = await app.inject({ method: 'GET', url: '/test/forbidden' });
      expect(res.statusCode).toBe(403);
      expect(res.json<ErrorPayload>().error.code).toBe('forbidden');
      expect(res.body).not.toContain('hunter2');
    });

    it('AppException with retryAfterSeconds -> 429 rate_limited + Retry-After', async () => {
      const res = await app.inject({ method: 'GET', url: '/test/limited' });
      expect(res.statusCode).toBe(429);
      expect(res.json<ErrorPayload>().error.code).toBe('rate_limited');
      expect(res.headers['retry-after']).toBe('30');
    });

    it('every emitted code is a declared ErrorCode', async () => {
      for (const url of ['/nope', '/test/boom', '/test/forbidden', '/test/limited']) {
        const res = await app.inject({ method: 'GET', url });
        expect(ERROR_CODES).toContain(res.json<ErrorPayload>().error.code);
      }
    });
  });

  describe('validation', () => {
    it('accepts a valid body', async () => {
      const res = await app.inject({ method: 'POST', url: '/test/echo', payload: { name: 'ok' } });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ name: 'ok' });
    });

    it('unknown field -> 400 validation_failed, without echoing the value', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/test/echo',
        payload: { name: 'ok', admin: 'SENTINEL_VALUE' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<ErrorPayload>().error.code).toBe('validation_failed');
      expect(res.body).not.toContain('SENTINEL_VALUE');
    });

    it('wrong type and missing field -> 400, message names the field only', async () => {
      const res = await app.inject({ method: 'POST', url: '/test/echo', payload: { name: 12345 } });
      expect(res.statusCode).toBe(400);
      const message = res.json<ErrorPayload>().error.message;
      expect(message).toContain('name');
      expect(message).not.toContain('12345');
    });

    it('malformed JSON -> 400 validation_failed', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/test/echo',
        headers: { 'content-type': 'application/json' },
        payload: '{not json',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<ErrorPayload>().error.code).toBe('validation_failed');
    });

    it('unsupported content type -> 415 in the standard shape', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/test/echo',
        headers: { 'content-type': 'application/xml' },
        payload: '<a/>',
      });
      expect(res.statusCode).toBe(415);
      expect(res.json<ErrorPayload>().error.code).toBe('validation_failed');
    });

    it('text/plain is parsed by Fastify but still fails schema validation', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/test/echo',
        headers: { 'content-type': 'text/plain' },
        payload: 'hello',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<ErrorPayload>().error.code).toBe('validation_failed');
    });
  });

  describe('body size limit (64 KB)', () => {
    it('allows a body under the limit', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/test/blob',
        payload: { blob: 'x'.repeat(BODY_LIMIT_BYTES - 1024) },
      });
      expect(res.statusCode).toBe(201);
    });

    it('rejects a body over the limit with 413 payload_too_large', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/test/blob',
        payload: { blob: 'x'.repeat(BODY_LIMIT_BYTES + 1024) },
      });
      expect(res.statusCode).toBe(413);
      expect(res.json<ErrorPayload>().error.code).toBe('payload_too_large');
    });
  });

  describe('request id', () => {
    it('echoes a well-formed x-request-id in the header and in the error body', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/test/boom',
        headers: { 'x-request-id': 'client-id_42' },
      });
      expect(res.headers['x-request-id']).toBe('client-id_42');
      expect(res.json<ErrorPayload>().error.requestId).toBe('client-id_42');
    });

    it('generates one when absent', async () => {
      const res = await app.inject({ method: 'GET', url: '/nope' });
      expect(res.headers['x-request-id']).toMatch(UUID);
      expect(res.json<ErrorPayload>().error.requestId).toBe(res.headers['x-request-id']);
    });

    it('replaces a malformed one instead of echoing it', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/nope',
        headers: { 'x-request-id': 'bad id with spaces' },
      });
      expect(res.headers['x-request-id']).toMatch(UUID);
    });
  });

  describe('CORS', () => {
    it('is off when no origins are configured', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/nope',
        headers: { origin: 'https://evil.example' },
      });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('allows only the configured origins', async () => {
      const corsApp = await createApp(['https://app.example']);
      try {
        const allowed = await corsApp.inject({
          method: 'GET',
          url: '/nope',
          headers: { origin: 'https://app.example' },
        });
        const denied = await corsApp.inject({
          method: 'GET',
          url: '/nope',
          headers: { origin: 'https://evil.example' },
        });
        expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example');
        expect(denied.headers['access-control-allow-origin']).toBeUndefined();
      } finally {
        await corsApp.close();
      }
    });
  });
});
