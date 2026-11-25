import { Module } from '@nestjs/common';
import { CoreModule } from './core.module.js';

/** The BullMQ worker process. Starts empty: the first queue arrives in Phase 2. */
@Module({ imports: [CoreModule] })
export class WorkerModule {}
