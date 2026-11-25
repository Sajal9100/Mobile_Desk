import { Module } from '@nestjs/common';
import { CoreModule } from './core.module.js';
import { HealthModule } from './modules/health/health.module.js';

/** The REST API process. Domain modules (auth, devices, sessions, ...) join it phase by phase. */
@Module({ imports: [CoreModule, HealthModule] })
export class AppModule {}
