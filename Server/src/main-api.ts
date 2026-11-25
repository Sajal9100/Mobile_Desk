import 'reflect-metadata';
import { AppModule } from './app.module.js';
import { runHttpProcess } from './bootstrap.js';

await runHttpProcess({ rootModule: AppModule, service: 'api', portKey: 'PORT_API' });
