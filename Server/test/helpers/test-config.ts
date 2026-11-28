import { generateKeyPairSync } from 'node:crypto';

/**
 * Test configuration. Key material is generated at run time and lives in memory only: no PEM is
 * ever committed (gitleaks would flag it, and `*.pem` is gitignored).
 */

export type Ed25519Pair = { privatePem: string; publicPem: string };

export function generateEd25519(): Ed25519Pair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

export const TEST_KID = 'test-key-1';

/** `JWT_PRIVATE_KEYS` and `JWT_ACTIVE_KID` for a fresh key. */
export function jwtEnv(
  kid = TEST_KID,
  pair = generateEd25519(),
): { env: Record<string, string>; pair: Ed25519Pair } {
  return {
    env: {
      JWT_PRIVATE_KEYS: JSON.stringify({ [kid]: pair.privatePem }),
      JWT_ACTIVE_KID: kid,
    },
    pair,
  };
}

/** The Play Integrity values used by tests that run in `enforce` mode (Google itself is mocked). */
export const TEST_PACKAGE_NAME = 'app.mobiledesk.test';
export const TEST_CERT_SHA256 = 'ab'.repeat(32);

export function googleServiceAccountJson(): string {
  return JSON.stringify({
    type: 'service_account',
    client_email: 'integrity@mobiledesk-test.iam.gserviceaccount.com',
    // Not used to sign anything in tests (the Google client is mocked): any PEM-shaped text will do.
    private_key: generateEd25519().privatePem,
  });
}

export function enforceEnv(): Record<string, string> {
  return {
    INTEGRITY_MODE: 'enforce',
    INTEGRITY_PACKAGE_NAME: TEST_PACKAGE_NAME,
    INTEGRITY_CERT_SHA256: TEST_CERT_SHA256,
    GOOGLE_SERVICE_ACCOUNT_JSON: googleServiceAccountJson(),
  };
}

/** A complete, valid environment for `parseConfig` (no server is started from it). */
export function validEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    PORT_API: '3000',
    PORT_REALTIME: '3001',
    DATABASE_URL: 'postgresql://user:pw@localhost:5432/db',
    REDIS_URL: 'redis://:pw@localhost:6379/0',
    APP_PUBLIC_BASE_URL: 'http://localhost:3000',
    INTEGRITY_MODE: 'bypass',
    ...jwtEnv().env,
    ...overrides,
  };
}
