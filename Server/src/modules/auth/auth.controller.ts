import { Body, Controller, Header, HttpCode, Inject, Post } from '@nestjs/common';
import { Public } from '../../common/guards/actor.js';
import { ClientIp } from '../../common/http/client-ip.js';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe.js';
import type { components } from '../../generated/openapi.js';
import {
  loginBodySchema,
  refreshBodySchema,
  registerBodySchema,
  type LoginBody,
  type RefreshBody,
  type RegisterBody,
} from './auth.schemas.js';
import { AuthService } from './auth.service.js';

/**
 * Thin on purpose: validate, call the service, return its result. These routes are public (no
 * access token yet) and every response is `no-store`: bodies carry tokens.
 */
@Controller('api/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  register(
    @Body(new ZodValidationPipe(registerBodySchema)) body: RegisterBody,
    @ClientIp() ip: string,
  ): Promise<components['schemas']['AuthResponse']> {
    return this.auth.register(body, ip);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  login(
    @Body(new ZodValidationPipe(loginBodySchema)) body: LoginBody,
    @ClientIp() ip: string,
  ): Promise<components['schemas']['AuthResponse']> {
    return this.auth.login(body, ip);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  refresh(
    @Body(new ZodValidationPipe(refreshBodySchema)) body: RefreshBody,
  ): Promise<components['schemas']['TokenPair']> {
    return this.auth.refresh(body);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  logout(@Body(new ZodValidationPipe(refreshBodySchema)) body: RefreshBody): Promise<void> {
    return this.auth.logout(body);
  }
}
