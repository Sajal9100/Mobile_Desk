import { Module } from '@nestjs/common';
import { RealtimeService } from './realtime.service.js';

/**
 * Lets the API process tell the realtime process to drop sockets. Not the realtime process itself:
 * that is `src/realtime.module.ts` (Phase 3).
 */
@Module({ providers: [RealtimeService], exports: [RealtimeService] })
export class RealtimeBridgeModule {}
