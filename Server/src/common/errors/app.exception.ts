import type { ErrorCode } from './codes.js';

/**
 * The only exception services should throw for expected failures. The global filter turns it into
 * `{ error: { code, message } }`. The message is shown to clients: never put secrets, tokens or
 * other users' data in it.
 */
export class AppException extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    /** Sent as the `Retry-After` header (429 and retryable 503). */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AppException';
  }

  static validationFailed(message = 'Request validation failed'): AppException {
    return new AppException('validation_failed', 400, message);
  }

  static unauthorized(message = 'Authentication required'): AppException {
    return new AppException('unauthorized', 401, message);
  }

  static forbidden(message = 'Not allowed'): AppException {
    return new AppException('forbidden', 403, message);
  }

  static notFound(message = 'Resource not found'): AppException {
    return new AppException('not_found', 404, message);
  }

  static conflict(message = 'Request conflicts with the current state'): AppException {
    return new AppException('conflict', 409, message);
  }

  static rateLimited(retryAfterSeconds: number, message = 'Too many requests'): AppException {
    return new AppException('rate_limited', 429, message, retryAfterSeconds);
  }

  static serviceUnavailable(message = 'Service temporarily unavailable'): AppException {
    return new AppException('service_unavailable', 503, message);
  }
}
