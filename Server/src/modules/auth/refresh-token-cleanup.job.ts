import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { ConfigService } from '../../common/config/config.service.js';
import { PrismaService } from '../../common/database/prisma.service.js';
import { LOGGER } from '../../common/logger.module.js';
import { EXPIRED_RETENTION_MS } from './refresh-token.service.js';

export const MAINTENANCE_QUEUE = 'maintenance';
export const REFRESH_TOKEN_CLEANUP_JOB = 'refresh-token-cleanup';
const RUN_EVERY_MS = 60 * 60 * 1000;
const RETRY_SCHEDULE_MS = 10_000;

/**
 * Deletes refresh tokens whose family expired more than 7 days ago. Safe to run twice (it only
 * deletes rows that match), so a retried or duplicated job does no harm.
 */
export async function deleteExpiredRefreshTokens(
  prisma: Pick<PrismaService, 'refreshToken'>,
  now: Date = new Date(),
): Promise<number> {
  const { count } = await prisma.refreshToken.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - EXPIRED_RETENTION_MS) } },
  });
  return count;
}

/**
 * The worker's only job in Phase 2: an hourly repeatable BullMQ job (`maintenance` queue).
 *
 * BullMQ needs its own Redis connections: its workers use blocking commands and require
 * `maxRetriesPerRequest: null`, which would break the fail-fast client the request path uses.
 * Redis being down at start is not fatal: the process stays up, logs the error code, and keeps
 * trying to register the schedule.
 *
 * Operations note (Phase 6): BullMQ needs the Redis eviction policy `noeviction`.
 */
@Injectable()
export class RefreshTokenCleanupJob implements OnModuleInit, OnModuleDestroy {
  private connections: Redis[] = [];
  private queue: Queue | undefined;
  private worker: Worker | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private stopped = false;
  private lastErrorLogAt = 0;

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    this.queue = new Queue(MAINTENANCE_QUEUE, { connection: this.newConnection() });
    this.queue.on('error', (error) => this.logRedisError(error));

    this.worker = new Worker(MAINTENANCE_QUEUE, (job) => this.process(job.name), {
      connection: this.newConnection(),
      concurrency: 1,
    });
    this.worker.on('error', (error) => this.logRedisError(error));
    this.worker.on('failed', (job, error) =>
      this.logger.error({ job: job?.name, name: error.name }, 'maintenance job failed'),
    );

    void this.scheduleWithRetry();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
    for (const connection of this.connections) connection.disconnect();
  }

  private newConnection(): Redis {
    const connection = new Redis(this.config.get('REDIS_URL'), { maxRetriesPerRequest: null });
    // An unhandled 'error' event would end the process.
    connection.on('error', (error) => this.logRedisError(error));
    this.connections.push(connection);
    return connection;
  }

  private async process(name: string): Promise<void> {
    if (name !== REFRESH_TOKEN_CLEANUP_JOB) return;
    const deleted = await deleteExpiredRefreshTokens(this.prisma);
    this.logger.info({ deleted }, 'expired refresh tokens deleted');
  }

  /** Registers the repeatable job; idempotent, so every worker start can do it. */
  private async scheduleWithRetry(): Promise<void> {
    if (this.stopped || this.queue === undefined) return;
    try {
      await this.queue.upsertJobScheduler(
        REFRESH_TOKEN_CLEANUP_JOB,
        { every: RUN_EVERY_MS },
        { name: REFRESH_TOKEN_CLEANUP_JOB, data: {} },
      );
      this.logger.info('refresh token cleanup scheduled (hourly)');
    } catch (error) {
      this.logRedisError(error);
      this.retryTimer = setTimeout(() => void this.scheduleWithRetry(), RETRY_SCHEDULE_MS);
    }
  }

  /** At most one line every 10 s while Redis is down; the error code only, never a URL. */
  private logRedisError(error: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorLogAt < 10_000) return;
    this.lastErrorLogAt = now;
    this.logger.warn({ code: (error as NodeJS.ErrnoException).code ?? 'unknown' }, 'queue error');
  }
}
