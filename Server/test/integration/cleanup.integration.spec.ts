import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigService, getRuntimeConfig } from '../../src/common/config/config.service.js';
import { sha256Hex } from '../../src/common/crypto.js';
import {
  MAINTENANCE_QUEUE,
  REFRESH_TOKEN_CLEANUP_JOB,
  RefreshTokenCleanupJob,
  deleteExpiredRefreshTokens,
} from '../../src/modules/auth/refresh-token-cleanup.job.js';
import { EXPIRED_RETENTION_MS } from '../../src/modules/auth/refresh-token.service.js';
import { createCapturingLogger, startStack, stopStack, type Stack } from './helpers/stack.js';

// Needs Docker. The worker's hourly job: delete refresh tokens expired more than 7 days ago.

const DAY = 24 * 60 * 60 * 1000;

describe('refresh token cleanup', () => {
  let stack: Stack;
  let userId: string;
  beforeAll(async () => {
    stack = await startStack();
    userId = (await stack.client.signUp()).user.id;
  });
  afterAll(async () => {
    await stopStack(stack);
  });

  /** A refresh-token row of its own family that expires `expiresInMs` from now (negative = past). */
  async function insertToken(expiresInMs: number, extra: { revoked?: boolean } = {}) {
    const raw = randomUUID();
    await stack.prisma.refreshToken.create({
      data: {
        userId,
        familyId: randomUUID(),
        tokenHash: sha256Hex(raw),
        expiresAt: new Date(Date.now() + expiresInMs),
        ...(extra.revoked === true ? { revokedAt: new Date() } : {}),
      },
    });
    return sha256Hex(raw);
  }
  const exists = async (tokenHash: string) =>
    (await stack.prisma.refreshToken.count({ where: { tokenHash } })) === 1;

  it('keeps tokens for 7 days after they expire (reuse forensics), then deletes them', async () => {
    expect(EXPIRED_RETENTION_MS).toBe(7 * DAY);
    const old = await insertToken(-8 * DAY);
    const veryOld = await insertToken(-40 * DAY, { revoked: true });
    const justExpired = await insertToken(-1 * DAY);
    const almostSeven = await insertToken(-6 * DAY - 23 * 60 * 60 * 1000);
    const alive = await insertToken(20 * DAY);
    const revokedButNotExpired = await insertToken(20 * DAY, { revoked: true });

    const deleted = await deleteExpiredRefreshTokens(stack.prisma);

    expect(deleted).toBeGreaterThanOrEqual(2);
    expect(await exists(old)).toBe(false);
    expect(await exists(veryOld)).toBe(false);
    expect(await exists(justExpired)).toBe(true);
    expect(await exists(almostSeven)).toBe(true);
    expect(await exists(alive)).toBe(true);
    expect(await exists(revokedButNotExpired)).toBe(true);
  });

  it('is safe to run twice: the second run deletes nothing and breaks nothing', async () => {
    await insertToken(-30 * DAY);
    const alive = await insertToken(5 * DAY);

    expect(await deleteExpiredRefreshTokens(stack.prisma)).toBeGreaterThanOrEqual(1);
    expect(await deleteExpiredRefreshTokens(stack.prisma)).toBe(0);
    expect(await exists(alive)).toBe(true);
  });

  it('uses the clock it is given, so a family is deleted exactly 7 days after it expired', async () => {
    const token = await insertToken(-1 * DAY); // expired yesterday
    // 5 days from now it has been expired for 6 days: still inside the 7-day retention.
    await deleteExpiredRefreshTokens(stack.prisma, new Date(Date.now() + 5 * DAY));
    expect(await exists(token)).toBe(true);
    await deleteExpiredRefreshTokens(stack.prisma, new Date(Date.now() + 7 * DAY));
    expect(await exists(token)).toBe(false);
  });

  it('never deletes the live session of a signed-in user', async () => {
    const user = await stack.client.signUp();
    await deleteExpiredRefreshTokens(stack.prisma, new Date(Date.now() + 29 * DAY));
    expect((await stack.client.refresh(user.refreshToken)).status).toBe(200);
  });

  describe('the BullMQ job (real Redis)', () => {
    let job: RefreshTokenCleanupJob;
    let queue: Queue;
    let connection: Redis;
    const capture = createCapturingLogger();

    beforeAll(() => {
      job = new RefreshTokenCleanupJob(
        new ConfigService(getRuntimeConfig()),
        stack.prisma,
        capture.logger,
      );
      job.onModuleInit();
      connection = new Redis(stack.redis.getConnectionUrl(), { maxRetriesPerRequest: null });
      queue = new Queue(MAINTENANCE_QUEUE, { connection });
    });
    afterAll(async () => {
      await queue.close();
      connection.disconnect();
      await job.onModuleDestroy();
    });

    it('registers an hourly repeatable job, and registering twice does not duplicate it', async () => {
      const find = async () =>
        (await queue.getJobSchedulers()).filter((entry) => entry.key === REFRESH_TOKEN_CLEANUP_JOB);
      let schedulers = await find();
      for (let attempt = 0; schedulers.length === 0 && attempt < 40; attempt++) {
        await delay(250);
        schedulers = await find();
      }
      expect(schedulers).toHaveLength(1);
      expect(schedulers[0]?.every).toBe(60 * 60 * 1000);

      // A second worker start upserts the same scheduler id: still exactly one.
      const second = new RefreshTokenCleanupJob(
        new ConfigService(getRuntimeConfig()),
        stack.prisma,
        capture.logger,
      );
      second.onModuleInit();
      await delay(1_000);
      expect(await find()).toHaveLength(1);
      await second.onModuleDestroy();
    });

    it('a job on the queue is processed by the worker and deletes the expired tokens', async () => {
      const expired = await insertToken(-9 * DAY);
      const alive = await insertToken(9 * DAY);

      await queue.add(REFRESH_TOKEN_CLEANUP_JOB, {});

      let gone = false;
      for (let attempt = 0; !gone && attempt < 80; attempt++) {
        gone = !(await exists(expired));
        if (!gone) await delay(250);
      }
      expect(gone).toBe(true);
      expect(await exists(alive)).toBe(true);
      expect(capture.text()).toContain('expired refresh tokens deleted');
    });
  });
});
