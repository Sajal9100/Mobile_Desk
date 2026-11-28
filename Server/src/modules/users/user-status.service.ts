import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import { PrismaService } from '../../common/database/prisma.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { LOGGER } from '../../common/logger.module.js';
import { RedisService } from '../../common/redis/redis.service.js';

/**
 * How long a "this user may act" answer is cached. This is also the longest a suspension or a
 * deletion can go unnoticed by an access token that is still valid (the brief's 60 s).
 */
export const USER_STATUS_TTL_SECONDS = 60;

const keyFor = (userId: string): string => `user-status:${userId}`;

type CachedStatus = 'active' | 'blocked';

/**
 * Whether a user is allowed to use the API: they exist, are `active`, and are not deleted.
 * The AuthGuard asks on every request, so the answer is cached in Redis for 60 s.
 */
@Injectable()
export class UserStatusService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async isActive(userId: string): Promise<boolean> {
    const cached = await this.readCache(userId);
    if (cached !== undefined) return cached === 'active';

    // The cache is an optimisation only: when it cannot answer we still decide, from the database.
    // If the database cannot answer either, deny with a retryable 503 (fail closed).
    let user: { status: string; deletedAt: Date | null } | null;
    try {
      user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { status: true, deletedAt: true },
      });
    } catch (error) {
      this.logger.warn({ name: (error as Error).name }, 'user status lookup failed, denying');
      throw AppException.serviceUnavailable();
    }

    const status: CachedStatus =
      user !== null && user.status === 'active' && user.deletedAt === null ? 'active' : 'blocked';
    await this.writeCache(userId, status);
    return status === 'active';
  }

  /** Forget the cached answer (after a suspension or a deletion) so the change applies at once. */
  async invalidate(userId: string): Promise<void> {
    try {
      await this.redis.client.del(keyFor(userId));
    } catch {
      // Best effort: the entry expires within USER_STATUS_TTL_SECONDS anyway.
      this.logger.warn({ userId }, 'could not clear the user status cache');
    }
  }

  private async readCache(userId: string): Promise<CachedStatus | undefined> {
    try {
      const value = await this.redis.client.get(keyFor(userId));
      return value === 'active' || value === 'blocked' ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private async writeCache(userId: string, status: CachedStatus): Promise<void> {
    try {
      await this.redis.client.set(keyFor(userId), status, 'EX', USER_STATUS_TTL_SECONDS);
    } catch {
      // Not fatal: the next request asks the database again.
    }
  }
}
