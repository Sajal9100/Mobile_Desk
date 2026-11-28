import { Module } from '@nestjs/common';
import { CoreModule } from './core.module.js';
import { AuthMaintenanceModule } from './modules/auth/auth-maintenance.module.js';

/** The BullMQ worker process. Phase 2: the hourly refresh-token cleanup. */
@Module({ imports: [CoreModule, AuthMaintenanceModule] })
export class WorkerModule {}
