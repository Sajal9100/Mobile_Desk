import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import { AppException } from '../errors/app.exception.js';
import { LOGGER } from '../logger.module.js';
import { RedisService } from '../redis/redis.service.js';

/**
 * Fixed-window counter. INCR + PEXPIRE run as one script so a key can never exist without a TTL
 * (even if the process dies between the two calls), and the script repairs a key that has none.
 * Returns { count, ttl in ms }.
 */
const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

export type RateLimitScope =
  | 'login:ip'
  | 'login:email'
  | 'register:ip'
  | 'refresh:family'
  | 'nonce:ip'
  | 'account-delete:user';

@Injectable()
export class RateLimitService {
  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Counts one attempt for `scope`/`id` and throws `429 rate_limited` (with Retry-After) once more
   * than `limit` attempts happened in the current `windowSeconds` window.
   *
   * Fail closed (rule 9): if Redis cannot answer, the action is denied with a retryable 503.
   * `id` must already be safe to store (an IP, a UUID or a hash), never a raw email or token.
   */
  async consume(
    scope: RateLimitScope,
    id: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    let count: number;
    let ttlMs: number;
    try {
      const reply = await this.redis.client.eval(
        CONSUME_SCRIPT,
        1,
        `rl:${scope}:${id}`,
        String(windowSeconds * 1000),
      );
      [count, ttlMs] = parseReply(reply);
    } catch (error) {
      this.logger.warn({ scope, code: errorCode(error) }, 'rate limiter unavailable, denying');
      throw AppException.serviceUnavailable();
    }

    if (count > limit) {
      throw AppException.rateLimited(Math.max(1, Math.ceil(ttlMs / 1000)));
    }
  }
}

function parseReply(reply: unknown): [number, number] {
  if (Array.isArray(reply) && typeof reply[0] === 'number' && typeof reply[1] === 'number') {
    return [reply[0], reply[1]];
  }
  throw new Error('unexpected rate limit script reply');
}

function errorCode(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? 'unknown';
}
