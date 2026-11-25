import { Global, Module } from '@nestjs/common';
import type { Logger } from 'pino';
import { getRuntimeConfig } from './config/config.service.js';
import { createLogger } from './logger.js';

/** DI token for the process-wide pino logger. */
export const LOGGER = Symbol('LOGGER');

let rootLogger: Logger | undefined;

/**
 * The one pino instance for this process. The entry point creates it (the Fastify adapter needs it
 * before Nest starts) and the same instance is injected everywhere through `LOGGER`.
 */
export function getRootLogger(service: string): Logger {
  rootLogger ??= createLogger({ level: getRuntimeConfig().LOG_LEVEL, service });
  return rootLogger;
}

@Global()
@Module({
  providers: [{ provide: LOGGER, useFactory: () => getRootLogger('mobiledesk') }],
  exports: [LOGGER],
})
export class LoggerModule {}
