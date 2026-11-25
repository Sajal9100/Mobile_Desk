import 'reflect-metadata';
import { runHttpProcess } from './bootstrap.js';
import { RealtimeModule } from './realtime.module.js';

await runHttpProcess({ rootModule: RealtimeModule, service: 'realtime', portKey: 'PORT_REALTIME' });
