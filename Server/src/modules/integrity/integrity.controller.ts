import { Controller, Get, Header, Inject } from '@nestjs/common';
import { ClientIp } from '../../common/http/client-ip.js';
import { Public } from '../../common/guards/actor.js';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service.js';
import type { components } from '../../generated/openapi.js';
import { NonceStore } from './nonce.store.js';

@Controller('api/integrity')
export class IntegrityController {
  constructor(
    @Inject(NonceStore) private readonly nonces: NonceStore,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
  ) {}

  /** One-time nonce for a Play Integrity request. 30 per minute per IP. */
  @Public()
  @Get('nonce')
  @Header('Cache-Control', 'no-store')
  async nonce(@ClientIp() ip: string): Promise<components['schemas']['IntegrityNonce']> {
    await this.rateLimit.consume('nonce:ip', ip, 30, 60);
    return { nonce: await this.nonces.issue() };
  }
}
