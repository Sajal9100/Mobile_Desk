import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Letters, digits, `_` and `-`, at most 64 characters: safe to echo in headers and logs. */
const VALID_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Use the caller's `x-request-id` only if it is well-formed, otherwise generate one.
 * Never trust the raw header: it ends up in logs and response headers (log/header injection).
 */
export function resolveRequestId(header: string | string[] | undefined): string {
  const candidate = Array.isArray(header) ? header[0] : header;
  return candidate !== undefined && VALID_REQUEST_ID.test(candidate) ? candidate : randomUUID();
}
