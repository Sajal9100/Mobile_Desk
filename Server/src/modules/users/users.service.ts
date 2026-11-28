import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/database/prisma.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import type { components } from '../../generated/openapi.js';

export type PublicUser = components['schemas']['User'];

/** The columns that are safe to return. `passwordHash` is never selected for a response. */
export const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  displayName: true,
  createdAt: true,
} as const;

export function toPublicUser(user: {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;
}): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
  };
}

@Injectable()
export class UsersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** The signed-in user. A user that vanished since the token was issued is a 401, not a 404. */
  async getPublicUser(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { ...PUBLIC_USER_SELECT, deletedAt: true },
    });
    if (user === null || user.deletedAt !== null) {
      throw AppException.unauthorized();
    }
    return toPublicUser(user);
  }
}
