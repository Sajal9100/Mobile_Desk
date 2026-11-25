import { Module } from '@nestjs/common';
import { CoreModule } from './core.module.js';
import { HealthModule } from './modules/health/health.module.js';

/** The Socket.IO process. Starts empty: the gateway arrives in Phase 3. */
@Module({ imports: [CoreModule, HealthModule] })
export class RealtimeModule {}
