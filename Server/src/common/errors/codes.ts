/**
 * Stable machine-readable error codes (rule 7). The app switches on these, so never rename one.
 * Keep `contracts/openapi.yaml` (components.schemas.ErrorCode) in sync: a unit test enforces it.
 */
export const ERROR_CODES = [
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'rate_limited',
  'conflict',
  'internal_error',
  'service_unavailable',
  'payload_too_large',
  // Phase 2 (accounts and authentication)
  'email_taken',
  'invalid_credentials',
  'invalid_refresh_token',
  'refresh_reuse_detected',
  'integrity_failed',
  'integrity_unavailable',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** The standard error response body. `requestId` mirrors the `x-request-id` response header. */
export type ErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    requestId?: string;
  };
};
