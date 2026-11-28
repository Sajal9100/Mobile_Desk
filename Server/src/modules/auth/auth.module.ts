import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module.js';
import { IntegrityModule } from '../integrity/integrity.module.js';
import { RealtimeBridgeModule } from '../realtime/realtime-bridge.module.js';
import { UsersModule } from '../users/users.module.js';
import { AccessTokenService } from './access-token.service.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

/**
 * Credentials and sessions of the API process: register, login, refresh, logout, account
 * deletion, and the global guard that protects every other route. (The refresh-token cleanup job
 * belongs to the worker: see AuthMaintenanceModule.)
 */
@Module({
  imports: [UsersModule, IntegrityModule, AuditModule, RealtimeBridgeModule],
  controllers: [AuthController, AccountController],
  providers: [
    PasswordService,
    AccessTokenService,
    RefreshTokenService,
    AuthService,
    AccountService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [PasswordService, AccessTokenService, RefreshTokenService],
})
export class AuthModule {}
