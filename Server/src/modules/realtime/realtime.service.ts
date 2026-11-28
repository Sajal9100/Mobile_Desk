import { Inject, Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import { LOGGER } from '../../common/logger.module.js';

/**
 * The API process's handle on the realtime process: "close these sockets now".
 *
 * Phase 2 only defines the hook, so refresh-reuse detection, logout and account deletion already
 * call it. It does nothing yet because no socket exists before Phase 3, which replaces the bodies
 * with a publish through the Socket.IO Redis adapter (`io.in('user:...').disconnectSockets(true)`).
 */
@Injectable()
export class RealtimeService {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  /** Disconnect every socket of the user (account deletion, suspension). */
  disconnectUser(userId: string): Promise<void> {
    this.logger.debug({ userId }, 'disconnectUser (no sockets yet)');
    return Promise.resolve();
  }

  /** Disconnect the sockets of one device (logout, refresh-token reuse, device removal). */
  disconnectDevice(deviceId: string): Promise<void> {
    this.logger.debug({ deviceId }, 'disconnectDevice (no sockets yet)');
    return Promise.resolve();
  }
}
