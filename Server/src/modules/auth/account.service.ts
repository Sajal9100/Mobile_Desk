import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import type { Actor } from '../../common/guards/actor.js';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { UserStatusService } from '../users/user-status.service.js';
import { PasswordService } from './password.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

@Injectable()
export class AccountService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(RefreshTokenService) private readonly refreshTokens: RefreshTokenService,
    @Inject(UserStatusService) private readonly userStatus: UserStatusService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  /**
   * Soft delete: the account stops working at once, the row (and its email) stays until the
   * hard-delete job of Phase 6.
   *
   * The password is asked for again, so a stolen access token alone cannot delete the account.
   * That makes this endpoint a password oracle for whoever holds such a token, hence its own limit
   * (5 attempts per 15 minutes per user) on top of the login limits.
   */
  async deleteAccount(actor: Actor, password: string): Promise<void> {
    await this.rateLimit.consume('account-delete:user', actor.userId, 5, 15 * 60);

    const user = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { passwordHash: true, deletedAt: true },
    });
    if (user === null || user.deletedAt !== null) throw AppException.unauthorized();

    if (!(await this.passwords.verify(user.passwordHash, password))) {
      // invalid_credentials, not unauthorized: the app must not treat this as an expired token.
      throw AppException.invalidCredentials();
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: actor.userId }, data: { deletedAt: new Date() } });
      await this.refreshTokens.revokeAllForUser(tx, actor.userId);
    });

    // Access tokens already issued stop working now, not after the status cache expires.
    await this.userStatus.invalidate(actor.userId);
    await this.realtime.disconnectUser(actor.userId);
    this.audit.record('account_deleted', { userId: actor.userId });
  }
}
