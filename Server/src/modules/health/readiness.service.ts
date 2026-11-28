import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import { PrismaService } from '../../common/database/prisma.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { LOGGER } from '../../common/logger.module.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { withTimeout } from '../../common/with-timeout.js';

export const READINESS_TIMEOUT_MS = 1_000;

export type ReadinessReport = {
  status: 'ok';
  checks: { database: 'ok'; redis: 'ok' };
};

@Injectable()
export class ReadinessService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Postgres `SELECT 1` and Redis `PING`, each limited to 1 s. If either fails the process is not
   * ready: 503. Which dependency failed goes to the log, not to the response body.
   */
  async check(): Promise<ReadinessReport> {
    const [database, redis] = await Promise.allSettled([
      withTimeout(this.prisma.$queryRaw`SELECT 1`, READINESS_TIMEOUT_MS),
      withTimeout(this.redis.ping(), READINESS_TIMEOUT_MS),
    ]);

    const failed: string[] = [];
    if (database.status === 'rejected') failed.push('database');
    if (redis.status === 'rejected') failed.push('redis');

    if (failed.length > 0) {
      this.logger.warn({ failed }, 'readiness check failed');
      throw AppException.serviceUnavailable('Service is not ready');
    }
    return { status: 'ok', checks: { database: 'ok', redis: 'ok' } };
  }
}
