import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Play Integrity, Standard requests (docs/DECISIONS.md, section C).
 *
 * The app asks Play for a token with `requestHash = computeRequestHash(action, nonce, email)`;
 * Google returns it unchanged inside the decoded token. A Standard token has no nonce of its own,
 * so the single-use Redis nonce that is part of the hash is what stops a token from being replayed.
 *
 * Everything here is pure: no network, no Redis, no clock except the `now` argument.
 */

/** Which request the token was made for. It is part of the hash, so a login token cannot register. */
export type IntegrityAction = 'register' | 'login';

/** Tokens older than this (or from the future by more than this) are rejected. */
export const MAX_TOKEN_AGE_MS = 120_000;

export const DEVICE_VERDICT = 'MEETS_DEVICE_INTEGRITY';
export const APP_VERDICT = 'PLAY_RECOGNIZED';

/**
 * base64url(SHA-256(UTF-8("<action>|<nonce>|<email>"))). `email` is the normalised address (trimmed,
 * lower-cased). Documented in contracts/openapi.yaml with a test vector; the app computes the same.
 */
export function computeRequestHash(action: IntegrityAction, nonce: string, email: string): string {
  return createHash('sha256').update(`${action}|${nonce}|${email}`, 'utf8').digest('base64url');
}

/** The part of Google's decoded token this server reads. Unknown fields are dropped. */
export const tokenPayloadSchema = z.object({
  requestDetails: z.object({
    requestPackageName: z.string(),
    requestHash: z.string().optional(),
    // int64 values arrive as strings in Google's JSON.
    timestampMillis: z.union([z.string(), z.number()]),
  }),
  appIntegrity: z
    .object({
      appRecognitionVerdict: z.string().optional(),
      certificateSha256Digest: z.array(z.string()).optional(),
    })
    .optional(),
  deviceIntegrity: z
    .object({ deviceRecognitionVerdict: z.array(z.string()).optional() })
    .optional(),
});
export type TokenPayload = z.infer<typeof tokenPayloadSchema>;

/** Machine-readable, value-free reasons. They go to the audit log, never to the client. */
export type VerdictReason =
  | 'nonce_invalid'
  | 'token_invalid'
  | 'wrong_package'
  | 'request_hash_mismatch'
  | 'stale_token'
  | 'app_not_recognized'
  | 'wrong_certificate'
  | 'device_not_integrity';

export type IntegrityVerdict = { ok: boolean; reasons: VerdictReason[] };

export type VerdictInput = {
  payload: TokenPayload;
  expectedPackageName: string;
  /** Trusted signing-certificate digests, lower-case hex (config INTEGRITY_CERT_SHA256). */
  trustedCertDigests: readonly string[];
  expectedRequestHash: string;
  nowMs: number;
};

function equalStrings(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Google reports certificate digests as base64url; the config (and the Play Console) use hex. */
function toHex(digest: string): string {
  return Buffer.from(digest, 'base64url').toString('hex');
}

/**
 * Applies every check and collects ALL failing reasons (not just the first), so the audit log shows
 * the full picture. `ok` is true only when there are no reasons.
 */
export function evaluateVerdict(input: VerdictInput): IntegrityVerdict {
  const { payload } = input;
  const reasons: VerdictReason[] = [];

  if (payload.requestDetails.requestPackageName !== input.expectedPackageName) {
    reasons.push('wrong_package');
  }

  if (
    payload.requestDetails.requestHash === undefined ||
    !equalStrings(payload.requestDetails.requestHash, input.expectedRequestHash)
  ) {
    reasons.push('request_hash_mismatch');
  }

  const issuedAt = Number(payload.requestDetails.timestampMillis);
  if (!Number.isFinite(issuedAt) || Math.abs(input.nowMs - issuedAt) > MAX_TOKEN_AGE_MS) {
    reasons.push('stale_token');
  }

  if (payload.appIntegrity?.appRecognitionVerdict !== APP_VERDICT) {
    reasons.push('app_not_recognized');
  }

  const reportedDigests = (payload.appIntegrity?.certificateSha256Digest ?? []).map(toHex);
  if (!reportedDigests.some((digest) => input.trustedCertDigests.includes(digest))) {
    reasons.push('wrong_certificate');
  }

  if (payload.deviceIntegrity?.deviceRecognitionVerdict?.includes(DEVICE_VERDICT) !== true) {
    reasons.push('device_not_integrity');
  }

  return { ok: reasons.length === 0, reasons };
}
