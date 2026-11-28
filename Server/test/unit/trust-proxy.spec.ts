import { Controller, Get, Module, Req } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { configureHttpApp, createFastifyAdapter } from '../../src/bootstrap.js';
import type { AppConfig } from '../../src/common/config/config.schema.js';
import { normalizeIp } from '../../src/common/http/client-ip.js';
import { createLogger } from '../../src/common/logger.js';

/** Which address does the server believe the caller has? It decides every per-IP rate limit. */

@Controller('test')
class WhoAmIController {
  @Get('ip')
  ip(@Req() request: FastifyRequest): { ip: string; key: string } {
    return { ip: request.ip, key: normalizeIp(request.ip) };
  }
}

@Module({ controllers: [WhoAmIController] })
class WhoAmIModule {}

const logger = createLogger(
  { level: 'silent', service: 'test' },
  new Writable({ write: (_chunk, _encoding, callback) => callback() }),
);

async function appWith(trustProxy: AppConfig['TRUST_PROXY']): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [WhoAmIModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createFastifyAdapter(logger, { trustProxy }),
  );
  configureHttpApp(app, { CORS_ORIGINS: [] }, logger);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

async function ipSeenBy(
  app: NestFastifyApplication,
  socket: string,
  forwardedFor?: string,
): Promise<string> {
  const response = await app.inject({
    method: 'GET',
    url: '/test/ip',
    remoteAddress: socket,
    ...(forwardedFor === undefined ? {} : { headers: { 'x-forwarded-for': forwardedFor } }),
  });
  return response.json<{ ip: string }>().ip;
}

describe('which client address the server uses', () => {
  it('by default it IGNORES X-Forwarded-For (a client cannot choose its own address)', async () => {
    const app = await appWith(false);
    try {
      expect(await ipSeenBy(app, '203.0.113.9')).toBe('203.0.113.9');
      expect(await ipSeenBy(app, '203.0.113.9', '1.2.3.4')).toBe('203.0.113.9');
      expect(await ipSeenBy(app, '203.0.113.9', '1.2.3.4, 5.6.7.8')).toBe('203.0.113.9');
    } finally {
      await app.close();
    }
  });

  it('with one trusted hop it reads the address the load balancer saw, not what the client claims', async () => {
    const app = await appWith(1);
    try {
      // The balancer (socket address) appended the real client as the LAST entry.
      expect(await ipSeenBy(app, '10.0.0.5', '198.51.100.7')).toBe('198.51.100.7');
      // A client that prepends fake entries cannot move the answer: only the last hop is trusted.
      expect(await ipSeenBy(app, '10.0.0.5', '1.1.1.1, 2.2.2.2, 198.51.100.7')).toBe(
        '198.51.100.7',
      );
      // No header: the socket address.
      expect(await ipSeenBy(app, '10.0.0.5')).toBe('10.0.0.5');
    } finally {
      await app.close();
    }
  });

  it('with a list of proxies it trusts the header only from those addresses', async () => {
    const app = await appWith(['10.0.0.0/8']);
    try {
      expect(await ipSeenBy(app, '10.1.2.3', '198.51.100.7')).toBe('198.51.100.7');
      // The same header from an address that is NOT a trusted proxy is ignored.
      expect(await ipSeenBy(app, '203.0.113.9', '198.51.100.7')).toBe('203.0.113.9');
    } finally {
      await app.close();
    }
  });

  it('the keyword loopback trusts a local proxy only', async () => {
    const app = await appWith(['loopback']);
    try {
      expect(await ipSeenBy(app, '127.0.0.1', '198.51.100.7')).toBe('198.51.100.7');
      expect(await ipSeenBy(app, '203.0.113.9', '198.51.100.7')).toBe('203.0.113.9');
    } finally {
      await app.close();
    }
  });
});
