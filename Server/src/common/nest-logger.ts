import type { LoggerService } from '@nestjs/common';
import type { Logger } from 'pino';

type Level = 'info' | 'error' | 'warn' | 'debug' | 'fatal';

/** Routes Nest's own framework logging (route mapping, startup errors) through pino. */
export class PinoNestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write('fatal', message, optionalParams);
  }

  private write(level: Level, message: unknown, optionalParams: unknown[]): void {
    const last = optionalParams[optionalParams.length - 1];
    const context = typeof last === 'string' ? last : undefined;
    const text = typeof message === 'string' ? message : 'framework message';
    this.logger[level]({ context }, text);
  }
}
