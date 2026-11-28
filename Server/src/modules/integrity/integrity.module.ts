import { Module } from '@nestjs/common';
import type { Logger } from 'pino';
import { ConfigService } from '../../common/config/config.service.js';
import { LOGGER } from '../../common/logger.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { IntegrityController } from './integrity.controller.js';
import { IntegrityService } from './integrity.service.js';
import { NonceStore } from './nonce.store.js';
import {
  PLAY_INTEGRITY_CLIENT,
  UnusedPlayIntegrityClient,
  createGooglePlayIntegrityClient,
  type PlayIntegrityClient,
} from './play-integrity.client.js';

@Module({
  imports: [AuditModule],
  controllers: [IntegrityController],
  providers: [
    NonceStore,
    IntegrityService,
    {
      provide: PLAY_INTEGRITY_CLIENT,
      inject: [ConfigService, LOGGER],
      useFactory: (config: ConfigService, logger: Logger): PlayIntegrityClient => {
        if (config.get('INTEGRITY_MODE') === 'bypass') return new UnusedPlayIntegrityClient();
        const packageName = config.get('INTEGRITY_PACKAGE_NAME');
        const credentials = config.get('GOOGLE_SERVICE_ACCOUNT_JSON');
        if (packageName === undefined || credentials === undefined) {
          // Cannot happen: the configuration schema requires both when INTEGRITY_MODE=enforce.
          throw new Error('Play Integrity is enforced but not configured');
        }
        return createGooglePlayIntegrityClient(packageName, credentials, logger);
      },
    },
  ],
  exports: [IntegrityService, NonceStore],
})
export class IntegrityModule {}
