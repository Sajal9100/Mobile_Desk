import { GoogleAuth } from 'google-auth-library';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { GoogleServiceAccount } from '../../common/config/config.schema.js';
import { AppException } from '../../common/errors/app.exception.js';
import { withTimeout } from '../../common/with-timeout.js';
import { tokenPayloadSchema, type TokenPayload } from './verdict.js';

/** DI token: tests replace the Google client with a mock (no test ever calls Google). */
export const PLAY_INTEGRITY_CLIENT = Symbol('PLAY_INTEGRITY_CLIENT');

export type DecodeResult =
  /** Google decoded the token. Whether it is acceptable is decided by `evaluateVerdict`. */
  | { kind: 'decoded'; payload: TokenPayload }
  /** Google says the token itself is invalid (malformed, expired, not for this app). */
  | { kind: 'rejected' };

export interface PlayIntegrityClient {
  /**
   * Asks Google to decode `token`. Throws `503 integrity_unavailable` when Google cannot be reached
   * or answers with an error that is not about the token (fail closed, rule 9).
   */
  decode(token: string): Promise<DecodeResult>;
}

const PLAYINTEGRITY_SCOPE = 'https://www.googleapis.com/auth/playintegrity';
const DECODE_TIMEOUT_MS = 5_000;

const decodeResponseSchema = z.object({ tokenPayloadExternal: tokenPayloadSchema });

export type GoogleClientOptions = {
  packageName: string;
  /** Returns an OAuth access token for the playintegrity scope. */
  getAccessToken: () => Promise<string | null | undefined>;
  logger: Logger;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
};

export class GooglePlayIntegrityClient implements PlayIntegrityClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GoogleClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async decode(token: string): Promise<DecodeResult> {
    const { logger } = this.options;

    let accessToken: string | null | undefined;
    try {
      accessToken = await withTimeout(this.options.getAccessToken(), DECODE_TIMEOUT_MS);
    } catch (error) {
      logger.error({ name: errorName(error) }, 'could not get a Google access token');
      throw AppException.integrityUnavailable();
    }
    if (accessToken === undefined || accessToken === null || accessToken === '') {
      logger.error('Google returned no access token');
      throw AppException.integrityUnavailable();
    }

    const url = `https://playintegrity.googleapis.com/v1/${encodeURIComponent(this.options.packageName)}:decodeIntegrityToken`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ integrityToken: token }),
        signal: AbortSignal.timeout(DECODE_TIMEOUT_MS),
      });
    } catch (error) {
      // Timeout or network failure. Never log the request (it contains the integrity token).
      logger.warn({ name: errorName(error) }, 'Play Integrity request failed');
      throw AppException.integrityUnavailable();
    }

    if (response.status === 400) {
      // The token itself is bad: this is a verdict, not an outage.
      await response.body?.cancel();
      return { kind: 'rejected' };
    }
    if (!response.ok) {
      await response.body?.cancel();
      // 401/403/404 mean OUR credentials, permissions or package setup are wrong: page someone.
      const ours = response.status === 401 || response.status === 403 || response.status === 404;
      logger[ours ? 'error' : 'warn']({ status: response.status }, 'Play Integrity API error');
      throw AppException.integrityUnavailable();
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      logger.error('Play Integrity response was not JSON');
      throw AppException.integrityUnavailable();
    }
    const parsed = decodeResponseSchema.safeParse(body);
    if (!parsed.success) {
      logger.error(
        { paths: parsed.error.issues.slice(0, 5).map((issue) => issue.path.join('.')) },
        'Play Integrity response has an unexpected shape',
      );
      throw AppException.integrityUnavailable();
    }
    return { kind: 'decoded', payload: parsed.data.tokenPayloadExternal };
  }
}

/** Builds the production client from the service account in the configuration. */
export function createGooglePlayIntegrityClient(
  packageName: string,
  credentials: GoogleServiceAccount,
  logger: Logger,
): GooglePlayIntegrityClient {
  const auth = new GoogleAuth({ credentials, scopes: [PLAYINTEGRITY_SCOPE] });
  return new GooglePlayIntegrityClient({
    packageName,
    logger,
    getAccessToken: () => auth.getAccessToken(),
  });
}

/** Stands in when INTEGRITY_MODE=bypass. The service never calls it; if it does, that is a bug. */
export class UnusedPlayIntegrityClient implements PlayIntegrityClient {
  decode(): Promise<DecodeResult> {
    return Promise.reject(new Error('Play Integrity client used while INTEGRITY_MODE=bypass'));
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
