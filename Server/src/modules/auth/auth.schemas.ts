import { z } from 'zod';
import type { components } from '../../generated/openapi.js';

/**
 * Request bodies (rule 6: strict objects, sizes enforced, unknown fields rejected). The shapes
 * follow contracts/openapi.yaml; the type checks at the bottom fail the build if they drift.
 */

/** Refresh tokens and nonces are 32 random bytes in base64url: exactly 43 characters. */
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Control, format (zero-width, bidi override...) and line/paragraph separator characters. */
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** Trimmed, lower-cased, at most 254 characters, a valid address. Stored and compared like this. */
export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const displayNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(50)
  .refine((value) => !CONTROL_OR_FORMAT.test(value));

/** 10-128 characters with at least one letter and one digit. Never trimmed or altered. */
export const newPasswordSchema = z
  .string()
  .min(10)
  .max(128)
  .regex(/\p{L}/u)
  .regex(/\p{Nd}/u);

const integrityToken = z.string().min(1).max(16_384);
const integrityNonce = z.string().regex(OPAQUE_TOKEN);
const refreshToken = z.string().regex(OPAQUE_TOKEN);

export const registerBodySchema = z.strictObject({
  displayName: displayNameSchema,
  email: emailSchema,
  password: newPasswordSchema,
  integrityToken,
  integrityNonce,
});

export const loginBodySchema = z.strictObject({
  email: emailSchema,
  // The password policy applies when a password is CREATED. Login only bounds the size.
  password: z.string().min(1).max(128),
  integrityToken,
  integrityNonce,
});

export const refreshBodySchema = z.strictObject({ refreshToken });

export const deleteAccountBodySchema = z.strictObject({
  password: z.string().min(1).max(128),
});

export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type RefreshBody = z.infer<typeof refreshBodySchema>;
export type DeleteAccountBody = z.infer<typeof deleteAccountBodySchema>;

// ---- compile-time contract check: every body must be assignable to its OpenAPI type ----------
type Schemas = components['schemas'];
type MustMatch<Body extends Contract, Contract> = Body;
export type RegisterMatchesContract = MustMatch<RegisterBody, Schemas['RegisterRequest']>;
export type LoginMatchesContract = MustMatch<LoginBody, Schemas['LoginRequest']>;
export type RefreshMatchesContract = MustMatch<RefreshBody, Schemas['RefreshRequest']>;
export type DeleteAccountMatchesContract = MustMatch<
  DeleteAccountBody,
  Schemas['DeleteAccountRequest']
>;
