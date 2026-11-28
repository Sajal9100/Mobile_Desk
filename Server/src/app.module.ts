import { Module } from '@nestjs/common';
import { CoreModule } from './core.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IntegrityModule } from './modules/integrity/integrity.module.js';
import { UsersModule } from './modules/users/users.module.js';

/**
 * The REST API process. Domain modules (auth, users, integrity, devices, sessions, ...) join it
 * phase by phase. AuthModule brings the global guard: every route needs a token unless it is
 * marked @Public().
 */
@Module({ imports: [CoreModule, HealthModule, UsersModule, IntegrityModule, AuthModule] })
export class AppModule {}
