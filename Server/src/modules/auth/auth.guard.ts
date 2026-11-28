import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppException } from '../../common/errors/app.exception.js';
import { IS_PUBLIC_KEY } from '../../common/guards/actor.js';
import { UserStatusService } from '../users/user-status.service.js';
import { AccessTokenService } from './access-token.service.js';

/** `Authorization: Bearer <jwt>`: exactly three base64url segments, nothing else. */
const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

/**
 * Global guard of the API process: every route needs a valid access token unless it is marked
 * `@Public()`. Protected by default, so a new route cannot be forgotten.
 *
 * It verifies the token, then asks whether the user may still act (active, not deleted; cached in
 * Redis for 60 s) and only then attaches `request.actor`. Every failure is the same
 * `401 unauthorized`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AccessTokenService) private readonly accessTokens: AccessTokenService,
    @Inject(UserStatusService) private readonly userStatus: UserStatusService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers.authorization;
    const token = typeof header === 'string' ? BEARER.exec(header)?.[1] : undefined;
    if (token === undefined) throw AppException.unauthorized();

    const actor = await this.accessTokens.verify(token);
    if (!(await this.userStatus.isActive(actor.userId))) throw AppException.unauthorized();

    request.actor = actor;
    return true;
  }
}
