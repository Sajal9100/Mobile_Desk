import { Body, Controller, Delete, Header, HttpCode, Inject } from '@nestjs/common';
import { CurrentActor, type Actor } from '../../common/guards/actor.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import { AccountService } from './account.service.js';
import { deleteAccountBodySchema, type DeleteAccountBody } from './auth.schemas.js';

@Controller('api/account')
export class AccountController {
  constructor(@Inject(AccountService) private readonly account: AccountService) {}

  /** Protected by the global AuthGuard. 204 on success. */
  @Delete()
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  delete(
    @CurrentActor() actor: Actor,
    @Body(new ZodValidationPipe(deleteAccountBodySchema)) body: DeleteAccountBody,
  ): Promise<void> {
    return this.account.deleteAccount(actor, body.password);
  }
}
