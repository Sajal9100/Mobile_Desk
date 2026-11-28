import {
  createParamDecorator,
  SetMetadata,
  type CustomDecorator,
  type ExecutionContext,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

/**
 * Who is calling, decided by the server from a verified access token and database state, never
 * from anything the client says about itself (rule 4). `deviceId` is null until the device is
 * registered (Phase 3).
 */
export type Actor = { userId: string; deviceId: string | null };

declare module 'fastify' {
  interface FastifyRequest {
    actor?: Actor;
  }
}

export const IS_PUBLIC_KEY = 'isPublic';

/** Routes are protected by default. `@Public()` opts a route out (health, register, login, ...). */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** The authenticated caller. Only valid on a route the AuthGuard protects. */
export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Actor => {
    const actor = context.switchToHttp().getRequest<FastifyRequest>().actor;
    if (actor === undefined) {
      // A protected route always has an actor; reaching this means a route lost its guard.
      throw new Error('CurrentActor used on a route without authentication');
    }
    return actor;
  },
);
