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

/** Prisma codes that mean "the database cannot be reached or is overloaded" (not a bug in a query). */
const DATABASE_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  'P1001', // cannot reach the server
  'P1002', // timed out reaching the server
  'P1008', // operation timed out
  'P1017', // server closed the connection
  'P2024', // timed out getting a connection from the pool
]);

/**
 * Fail closed (rule 9): when Postgres is down the caller gets a retryable 503, not a bare 500 that
 * looks like a bug. Matched by name so this file does not depend on the generated client.
 */
function isDatabaseUnavailable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  if (name === 'PrismaClientInitializationError') return true;
  return (
    name === 'PrismaClientKnownRequestError' &&
    typeof code === 'string' &&
    DATABASE_UNAVAILABLE_CODES.has(code)
  );
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
  if (isDatabaseUnavailable(exception)) {
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
