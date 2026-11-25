import 'reflect-metadata';
import { runWorkerProcess } from './bootstrap.js';
import { WorkerModule } from './worker.module.js';

await runWorkerProcess({ rootModule: WorkerModule, service: 'worker' });
