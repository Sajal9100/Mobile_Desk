import { Module } from '@nestjs/common';
import { RefreshTokenCleanupJob } from './refresh-token-cleanup.job.js';

/** Background jobs of the auth domain. Imported by the worker process only. */
@Module({ providers: [RefreshTokenCleanupJob] })
export class AuthMaintenanceModule {}
