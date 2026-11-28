import {
  Catch,
  HttpException,
  Inject,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import { LOGGER } from '../logger.module.js';
import { AppException } from './app.exception.js';
import type { ErrorBody, ErrorCode } from './codes.js';

type ApiError = {
  status: number;
  code: ErrorCode;
  message: string;
  retryAfterSeconds?: number;
};

const INTERNAL_ERROR: ApiError = {
  status: 500,
  code: 'internal_error',
  message: 'Internal server error',
};

function fromStatus(status: number): ApiError {
  switch (status) {
    case 400:
      return { status, code: 'validation_failed', message: 'Malformed request' };
    case 401:
      return { status, code: 'unauthorized', message: 'Authentication required' };
    case 403:
      return { status, code: 'forbidden', message: 'Not allowed' };
    case 404:
      return { status, code: 'not_found', message: 'Resource not found' };
    case 409:
      return { status, code: 'conflict', message: 'Request conflicts with the current state' };
    case 413:
      return { status, code: 'payload_too_large', message: 'Request body is too large' };
    case 415:
      return { status, code: 'validation_failed', message: 'Unsupported content type' };
    case 429:
      return { status, code: 'rate_limited', message: 'Too many requests' };
    case 503:
      return { status, code: 'service_unavailable', message: 'Service temporarily unavailable' };
    default:
      // Any other 4xx is still the caller's problem; anything else is ours.
      return status >= 400 && status < 500
        ? { status, code: 'validation_failed', message: 'Request could not be processed' }
        : INTERNAL_ERROR;
  }
}

/** Fastify's own errors (bad JSON, body too large, ...) are plain errors with a statusCode. */
function hasStatusCode(error: unknown): error is { statusCode: number } {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { statusCode?: unknown }).statusCode === 'number'
  );
}

/**
 * Error codes that mean "a dependency (almost always Postgres) cannot be reached or is overloaded",
 * as opposed to a bug in a query. Found by stopping a real Postgres under Prisma 7 + the pg adapter:
 * a server that was never reachable gives a Prisma code (P1001), but one that WAS connected and
 * then went away surfaces the raw socket code (ECONNREFUSED, also inside an AggregateError).
 */
const DEPENDENCY_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  // Prisma
  'P1001', // cannot reach the server
  'P1002', // timed out reaching the server
  'P1008', // operation timed out
  'P1017', // server closed the connection
  'P2024', // timed out getting a connection from the pool
  // Node network errors surfaced by the driver
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  // PostgreSQL: admin shutdown, crash shutdown, cannot connect now, too many connections,
  // connection exceptions
  '57P01',
  '57P02',
  '57P03',
  '53300',
  '08000',
  '08001',
  '08003',
  '08006',
]);

/**
 * Messages of the pg driver / pool for a connection that died or could not be made. They carry no
 * error code: a pooled connection killed by a stopping server surfaces as a plain
 * `Error("Connection terminated unexpectedly")` (seen with the real driver). Only used to choose
 * 503 over 500; the message itself is never sent to the client.
 */
const DEPENDENCY_UNAVAILABLE_MESSAGES: readonly string[] = [
  'Connection terminated', // "...unexpectedly" and "...due to connection timeout"
  'timeout exceeded when trying to connect',
  'Client has encountered a connection error',
  "Can't reach database server",
];

/**
 * Fail closed (rule 9): when Postgres (or Redis) is down the caller gets a retryable 503, not a bare
 * 500 that looks like a bug. Matched by name, code and driver message, so this file does not depend
 * on the generated client. A wrapped error is followed through `cause` (a few levels at most).
 */
function isDependencyUnavailable(error: unknown, depth = 0): boolean {
  if (typeof error !== 'object' || error === null || depth > 3) return false;
  const { name, code, message, cause } = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    cause?: unknown;
  };
  if (name === 'PrismaClientInitializationError') return true;
  if (typeof code === 'string' && DEPENDENCY_UNAVAILABLE_CODES.has(code)) return true;
  if (
    typeof message === 'string' &&
    DEPENDENCY_UNAVAILABLE_MESSAGES.some((fragment) => message.includes(fragment))
  ) {
    return true;
  }
  return isDependencyUnavailable(cause, depth + 1);
}

export function toApiError(exception: unknown): ApiError {
  if (exception instanceof AppException) {
    return {
      status: exception.status,
      code: exception.code,
      message: exception.message,
      ...(exception.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: exception.retryAfterSeconds }),
    };
  }
  if (exception instanceof HttpException) {
    return fromStatus(exception.getStatus());
  }
  if (hasStatusCode(exception)) {
    return fromStatus(exception.statusCode);
  }
  if (isDependencyUnavailable(exception)) {
    return fromStatus(503);
  }
  return INTERNAL_ERROR;
}

/**
 * Every error leaves the server in the standard shape `{ error: { code, message, requestId } }`.
 * Messages are fixed strings: they never echo the route, the input or an internal error, and an
 * unknown error is a bare 500 with no stack in the body (the stack goes to the log only).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const apiError = toApiError(exception);

    // Expected failures (AppException) are logged by the code that raised them, if at all. Only an
    // unexpected 5xx logs here, with the stack: a probe answering 503 must not spam error logs.
    if (apiError.status >= 500 && !(exception instanceof AppException)) {
      this.logger.error({ err: exception, requestId: request.id }, 'unhandled error');
    }

    const body: ErrorBody = {
      error: { code: apiError.code, message: apiError.message, requestId: request.id },
    };
    if (apiError.retryAfterSeconds !== undefined) {
      void reply.header('retry-after', String(apiError.retryAfterSeconds));
    }
    void reply.status(apiError.status).type('application/json; charset=utf-8').send(body);
  }
}
