import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { newOpaqueToken, sha256Hex } from '../../common/crypto.js';
import { PrismaService } from '../../common/database/prisma.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

/** A refresh-token family lives 30 days from login, whatever the activity (absolute expiry). */
export const REFRESH_FAMILY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Expired rows are kept this long (for reuse forensics) before the cleanup job deletes them. */
export const EXPIRED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type IssuedFamily = { refreshToken: string; familyId: string };
export type RotatedTokens = { userId: string; deviceId: string | null; refreshToken: string };

type LockedRow = {
  id: string;
  userId: string;
  deviceId: string | null;
  familyId: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  userStatus: string;
  userDeletedAt: Date | null;
};

/** What happened inside the transaction. Exceptions are thrown only AFTER it has committed. */
type RotationOutcome =
  | { kind: 'invalid' }
  | { kind: 'reuse'; userId: string; deviceId: string | null; familyId: string }
  | ({ kind: 'rotated' } & RotatedTokens);

@Injectable()
export class RefreshTokenService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  /**
   * Starts a new family (login, register): a random token whose SHA-256 is stored, valid for 30
   * days. Pass the transaction client to make it part of a larger unit of work.
   */
  async issueFamily(
    db: Prisma.TransactionClient,
    userId: string,
    deviceId: string | null,
  ): Promise<IssuedFamily> {
    const refreshToken = newOpaqueToken();
    const familyId = randomUUID();
    await db.refreshToken.create({
      data: {
        userId,
        deviceId,
        familyId,
        tokenHash: sha256Hex(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_FAMILY_TTL_MS),
      },
    });
    return { refreshToken, familyId };
  }

  /**
   * Rotation with reuse detection.
   *
   * Every refresh marks the presented token used and hands out its successor in the same family.
   * Presenting a token that was already used means two parties hold it (a theft, or an app bug that
   * refreshes twice): the whole family is revoked and the caller must sign in again.
   *
   * The work runs in one transaction that first takes a per-family advisory lock and then the row
   * lock. The row lock alone is not enough: a reuse revocation running while the successor token is
   * being refreshed could miss the token that was just inserted and leave one live token behind.
   * There is deliberately no grace window for concurrent refreshes (the app single-flights them).
   */
  async rotate(rawToken: string): Promise<RotatedTokens> {
    const tokenHash = sha256Hex(rawToken);

    // Which family, for the rate limit and the lock. Unknown token: nothing to limit or lock.
    const known = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { familyId: true },
    });
    if (known === null) throw AppException.invalidRefreshToken();

    await this.rateLimit.consume('refresh:family', known.familyId, 30, 15 * 60);

    const outcome = await this.prisma.$transaction((tx) =>
      this.rotateInTransaction(tx, tokenHash, known.familyId),
    );

    if (outcome.kind === 'invalid') throw AppException.invalidRefreshToken();
    if (outcome.kind === 'reuse') {
      this.audit.record('refresh_reuse_detected', {
        userId: outcome.userId,
        familyId: outcome.familyId,
        deviceId: outcome.deviceId,
      });
      if (outcome.deviceId !== null) await this.realtime.disconnectDevice(outcome.deviceId);
      throw AppException.refreshReuseDetected();
    }
    return {
      userId: outcome.userId,
      deviceId: outcome.deviceId,
      refreshToken: outcome.refreshToken,
    };
  }

  /** Logout: revoke every token of the presented token's family. Unknown tokens are not an error. */
  async revokeFamilyOf(rawToken: string): Promise<void> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256Hex(rawToken) },
      select: { familyId: true, deviceId: true },
    });
    if (row === null) return;

    await this.prisma.$transaction(async (tx) => {
      await this.lockFamily(tx, row.familyId);
      await tx.refreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    if (row.deviceId !== null) await this.realtime.disconnectDevice(row.deviceId);
  }

  /** Revoke every family of a user (account deletion, suspension). */
  async revokeAllForUser(db: Prisma.TransactionClient, userId: string): Promise<void> {
    await db.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async rotateInTransaction(
    tx: Prisma.TransactionClient,
    tokenHash: string,
    familyId: string,
  ): Promise<RotationOutcome> {
    await this.lockFamily(tx, familyId);

    const rows = await tx.$queryRaw<LockedRow[]>`
      SELECT rt.id,
             rt.user_id     AS "userId",
             rt.device_id   AS "deviceId",
             rt.family_id   AS "familyId",
             rt.expires_at  AS "expiresAt",
             rt.used_at     AS "usedAt",
             rt.revoked_at  AS "revokedAt",
             u.status::text AS "userStatus",
             u.deleted_at   AS "userDeletedAt"
        FROM refresh_tokens rt
        JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = ${tokenHash}
         FOR UPDATE OF rt`;
    const row = rows[0];
    const now = new Date();

    if (row === undefined) return { kind: 'invalid' };
    if (row.revokedAt !== null || row.expiresAt < now) return { kind: 'invalid' };

    if (row.usedAt !== null) {
      // REUSE: this token was already rotated. Revoke the whole family and COMMIT that: the caller
      // throws only after this transaction has finished, otherwise the rollback would undo it.
      await tx.refreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      return { kind: 'reuse', userId: row.userId, deviceId: row.deviceId, familyId: row.familyId };
    }

    // A suspended or deleted account cannot keep a session alive through refresh.
    if (row.userStatus !== 'active' || row.userDeletedAt !== null) return { kind: 'invalid' };

    await tx.refreshToken.update({ where: { id: row.id }, data: { usedAt: now } });
    const refreshToken = newOpaqueToken();
    await tx.refreshToken.create({
      data: {
        userId: row.userId,
        deviceId: row.deviceId,
        familyId: row.familyId,
        tokenHash: sha256Hex(refreshToken),
        // The family's absolute expiry is kept: refreshing never extends it.
        expiresAt: row.expiresAt,
      },
    });
    return { kind: 'rotated', userId: row.userId, deviceId: row.deviceId, refreshToken };
  }

  /** Serialises every rotation and revocation of one family until the transaction ends. */
  private async lockFamily(tx: Prisma.TransactionClient, familyId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${familyId}, 0))`;
  }
}
