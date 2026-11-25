import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { ConfigService } from '../config/config.service.js';
import { LOGGER } from '../logger.module.js';

const ERROR_LOG_INTERVAL_MS = 10_000;

/**
 * Shared Redis client for request-path use (rate limits, nonces, tickets, presence).
 *
 * Fail fast (rule 9): with `enableOfflineQueue: false` a command issued while Redis is unreachable
 * rejects immediately instead of queueing, so callers deny the action rather than hang or allow it.
 * BullMQ gets its own connections in Phase 2.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;
  private lastErrorLogAt = 0;

  constructor(
    @Inject(ConfigService) config: ConfigService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {
    this.client = new Redis(config.get('REDIS_URL'), {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
      retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
    });
    // Without a listener an 'error' event would crash the process. Log at most every 10 s while
    // Redis is down; the message is the error code only (never a URL or credential).
    this.client.on('error', (error: NodeJS.ErrnoException) => {
      const now = Date.now();
      if (now - this.lastErrorLogAt >= ERROR_LOG_INTERVAL_MS) {
        this.lastErrorLogAt = now;
        this.logger.warn({ code: error.code ?? 'unknown' }, 'redis connection error');
      }
    });
  }

  /** Resolves when Redis answers PING; rejects otherwise. */
  async ping(): Promise<void> {
    const reply = await this.client.ping();
    if (reply !== 'PONG') {
      throw new Error('unexpected PING reply');
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
