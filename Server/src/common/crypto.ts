import { createHash, randomBytes } from 'node:crypto';

/** SHA-256 as lower-case hex: how refresh tokens are stored and how rate-limit keys hide emails. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** 32 random bytes, base64url (43 characters): refresh tokens, nonces, tickets. */
export function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}
