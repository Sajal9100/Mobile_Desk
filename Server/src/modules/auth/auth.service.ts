import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import { sha256Hex } from '../../common/crypto.js';
import { PrismaService } from '../../common/database/prisma.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import { LOGGER } from '../../common/logger.module.js';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service.js';
import type { components } from '../../generated/openapi.js';
import { Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';
import { IntegrityService } from '../integrity/integrity.service.js';
import { PUBLIC_USER_SELECT, toPublicUser } from '../users/users.service.js';
import { AccessTokenService } from './access-token.service.js';
import type { LoginBody, RefreshBody, RegisterBody } from './auth.schemas.js';
import { PasswordService } from './password.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

type AuthResponse = components['schemas']['AuthResponse'];
type TokenPair = components['schemas']['TokenPair'];

const FIFTEEN_MINUTES = 15 * 60;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(AccessTokenService) private readonly accessTokens: AccessTokenService,
    @Inject(RefreshTokenService) private readonly refreshTokens: RefreshTokenService,
    @Inject(IntegrityService) private readonly integrity: IntegrityService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async register(body: RegisterBody, ip: string): Promise<AuthResponse> {
    await this.rateLimit.consume('register:ip', ip, 5, 60 * 60);
    await this.integrity.require({
      action: 'register',
      nonce: body.integrityNonce,
      token: body.integrityToken,
      email: body.email,
    });

    // Hash before touching the database: an "email taken" answer then costs the same as a success.
    const passwordHash = await this.passwords.hash(body.password);

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: body.email,
            passwordHash,
            displayName: body.displayName,
            settings: { create: {} },
          },
          select: PUBLIC_USER_SELECT,
        });
        const family = await this.refreshTokens.issueFamily(tx, user.id, null);
        return { user, refreshToken: family.refreshToken };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw AppException.emailTaken();
      throw error;
    }

    return {
      user: toPublicUser(created.user),
      accessToken: await this.accessTokens.sign(created.user.id, null),
      refreshToken: created.refreshToken,
    };
  }

  async login(body: LoginBody, ip: string): Promise<AuthResponse> {
    await this.rateLimit.consume('login:ip', ip, 30, FIFTEEN_MINUTES);
    await this.integrity.require({
      action: 'login',
      nonce: body.integrityNonce,
      token: body.integrityToken,
      email: body.email,
    });
    // The per-email limit is counted only AFTER the integrity check passed. Counted before it,
    // anyone who knows an address could lock that user out for 15 minutes with ten junk requests.
    // Password guessing is not weakened: a guess needs a valid verdict and a fresh nonce first.
    // The email is hashed so the address never appears in a Redis key.
    await this.rateLimit.consume('login:email', sha256Hex(body.email), 10, FIFTEEN_MINUTES);

    const user = await this.prisma.user.findUnique({
      where: { email: body.email },
      select: { ...PUBLIC_USER_SELECT, passwordHash: true, status: true, deletedAt: true },
    });

    if (user === null || user.deletedAt !== null) {
      // Same work, same answer as a wrong password: nothing reveals whether the account exists.
      await this.passwords.verifyAgainstDummy(body.password);
      this.audit.record('login_failed', { reason: user === null ? 'unknown_email' : 'deleted' });
      throw AppException.invalidCredentials();
    }

    if (!(await this.passwords.verify(user.passwordHash, body.password))) {
      this.audit.record('login_failed', { reason: 'wrong_password', userId: user.id });
      throw AppException.invalidCredentials();
    }

    // Only someone who knows the password learns that the account is suspended.
    if (user.status !== 'active') {
      this.audit.record('login_failed', { reason: 'suspended', userId: user.id });
      throw AppException.forbidden('This account is not allowed to sign in');
    }

    await this.upgradePasswordHashIfNeeded(user.id, user.passwordHash, body.password);

    const family = await this.refreshTokens.issueFamily(this.prisma, user.id, null);
    return {
      user: toPublicUser(user),
      accessToken: await this.accessTokens.sign(user.id, null),
      refreshToken: family.refreshToken,
    };
  }

  async refresh(body: RefreshBody): Promise<TokenPair> {
    const rotated = await this.refreshTokens.rotate(body.refreshToken);
    return {
      accessToken: await this.accessTokens.sign(rotated.userId, rotated.deviceId),
      refreshToken: rotated.refreshToken,
    };
  }

  async logout(body: RefreshBody): Promise<void> {
    await this.refreshTokens.revokeFamilyOf(body.refreshToken);
  }

  /** Re-hash with today's parameters after a successful login. A failure here must not block it. */
  private async upgradePasswordHashIfNeeded(
    userId: string,
    storedHash: string,
    password: string,
  ): Promise<void> {
    if (!this.passwords.needsRehash(storedHash)) return;
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await this.passwords.hash(password) },
      });
    } catch (error) {
      this.logger.warn({ userId, name: (error as Error).name }, 'password re-hash failed');
    }
  }
}
