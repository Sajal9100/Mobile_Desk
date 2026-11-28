import type { IncomingMessage } from 'node:http';
import type { Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { LogController } from 'fastify';
import type { Logger } from 'pino';
import type { AppConfig } from './common/config/config.schema.js';
import { setRuntimeConfig } from './common/config/config.service.js';
import { loadConfigOrExit, loadDotEnvIfPresent } from './common/config/load-config.js';
import { getRootLogger } from './common/logger.module.js';
import { PinoNestLogger } from './common/nest-logger.js';
import { REQUEST_ID_HEADER, resolveRequestId } from './common/request-id.js';

/** Request bodies are capped at 64 KB (Phase 0 §2.4). Bigger -> 413 payload_too_large. */
export const BODY_LIMIT_BYTES = 64 * 1024;

const PROBE_PATHS: ReadonlySet<string> = new Set(['/health', '/ready']);

/** A hop count n means "trust the n proxies closest to us" (proxy-addr semantics). */
function toFastifyTrustProxy(
  value: AppConfig['TRUST_PROXY'],
): boolean | string[] | ((address: string, hop: number) => boolean) {
  return typeof value === 'number' ? (_address, hop) => hop < value : value;
}

/**
 * `trustProxy` says which proxies may set X-Forwarded-For (config TRUST_PROXY). Off by default:
 * `request.ip` is then the socket address, so a client cannot pick its own IP for the rate limits.
 */
export function createFastifyAdapter(
  logger: Logger,
  options: { trustProxy?: AppConfig['TRUST_PROXY'] } = {},
): FastifyAdapter {
  return new FastifyAdapter({
    loggerInstance: logger,
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: toFastifyTrustProxy(options.trustProxy ?? false),
    // Load-balancer probes would otherwise write two log lines every few seconds.
    logController: new LogController({
      disableRequestLogging: (request: { url: string }) => PROBE_PATHS.has(request.url),
    }),
    // We validate the caller's id ourselves (resolveRequestId) instead of trusting the header.
    requestIdHeader: false,
    genReqId: (req: IncomingMessage) => resolveRequestId(req.headers[REQUEST_ID_HEADER]),
  });
}

/** Everything an HTTP app needs beyond its modules. Shared by the real processes and by tests. */
export function configureHttpApp(
  app: NestFastifyApplication,
  config: Pick<AppConfig, 'CORS_ORIGINS'>,
  logger: Logger,
): void {
  app.useLogger(new PinoNestLogger(logger));

  // Echo the request id on every response so a client report can be matched to a log line.
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', (request, reply, payload, done) => {
      void reply.header(REQUEST_ID_HEADER, request.id);
      done(null, payload);
    });

  // Mobile-only API: no CORS unless origins are configured explicitly.
  if (config.CORS_ORIGINS.length > 0) {
    app.enableCors({ origin: config.CORS_ORIGINS });
  }
  app.enableShutdownHooks();
}

function startProcess(service: string): { config: AppConfig; logger: Logger } {
  loadDotEnvIfPresent();
  const config = loadConfigOrExit(); // exits non-zero, naming variables only
  setRuntimeConfig(config);
  return { config, logger: getRootLogger(service) };
}

function failStartup(logger: Logger, error: unknown): never {
  logger.fatal({ err: error }, 'startup failed');
  return process.exit(1);
}

export async function runHttpProcess(options: {
  rootModule: Type<unknown>;
  service: string;
  portKey: 'PORT_API' | 'PORT_REALTIME';
}): Promise<void> {
  const { config, logger } = startProcess(options.service);
  try {
    const app = await NestFactory.create<NestFastifyApplication>(
      options.rootModule,
      createFastifyAdapter(logger, { trustProxy: config.TRUST_PROXY }),
      { bufferLogs: true },
    );
    configureHttpApp(app, config, logger);
    await app.listen(config[options.portKey], config.BIND_HOST);
    logger.info({ port: config[options.portKey], host: config.BIND_HOST }, 'listening');
  } catch (error) {
    failStartup(logger, error);
  }
}

export async function runWorkerProcess(options: {
  rootModule: Type<unknown>;
  service: string;
}): Promise<void> {
  const { logger } = startProcess(options.service);
  try {
    const app = await NestFactory.createApplicationContext(options.rootModule, {
      bufferLogs: true,
    });
    app.useLogger(new PinoNestLogger(logger));
    app.enableShutdownHooks();
    logger.info('worker started (no queues yet)');
  } catch (error) {
    failStartup(logger, error);
  }
}
