import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import { AppException } from '../../common/errors/app.exception.js';
import { LOGGER } from '../../common/logger.module.js';
import { RedisService } from '../../common/redis/redis.service.js';

export const NONCE_TTL_SECONDS = 300;

const keyFor = (nonce: string): string => `integrity-nonce:${nonce}`;

/** Single-use nonces for Play Integrity requests, kept in Redis for 5 minutes. */
@Injectable()
export class NonceStore {
  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /** 32 random bytes, base64url (43 characters). */
  async issue(): Promise<string> {
    const nonce = randomBytes(32).toString('base64url');
    try {
      await this.redis.client.set(keyFor(nonce), '1', 'EX', NONCE_TTL_SECONDS, 'NX');
    } catch (error) {
      this.logger.warn({ code: (error as NodeJS.ErrnoException).code }, 'nonce store unavailable');
      throw AppException.serviceUnavailable();
    }
    return nonce;
  }

  /**
   * Deletes the nonce and says whether it existed. GETDEL is atomic, so of two concurrent requests
   * with the same nonce exactly one gets `true`. Unknown, expired and already-used are all `false`.
   */
  async consume(nonce: string): Promise<boolean> {
    try {
      return (await this.redis.client.getdel(keyFor(nonce))) !== null;
    } catch (error) {
      this.logger.warn({ code: (error as NodeJS.ErrnoException).code }, 'nonce store unavailable');
      throw AppException.serviceUnavailable();
    }
  }
}
