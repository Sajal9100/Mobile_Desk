import { Controller, Get, Header, Inject } from '@nestjs/common';
import { CurrentActor, type Actor } from '../../common/guards/actor.js';
import type { components } from '../../generated/openapi.js';
import { UsersService } from './users.service.js';

@Controller('api')
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  /** The signed-in user (protected by the global AuthGuard). */
  @Get('me')
  @Header('Cache-Control', 'no-store')
  async me(@CurrentActor() actor: Actor): Promise<{ user: components['schemas']['User'] }> {
    return { user: await this.users.getPublicUser(actor.userId) };
  }
}
