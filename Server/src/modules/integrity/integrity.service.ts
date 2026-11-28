import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Logger } from 'pino';
import { ConfigService } from '../../common/config/config.service.js';
import { LOGGER } from '../../common/logger.module.js';
import { AppException } from '../../common/errors/app.exception.js';
import { AuditService } from '../audit/audit.service.js';
import { NonceStore } from './nonce.store.js';
import { PLAY_INTEGRITY_CLIENT, type PlayIntegrityClient } from './play-integrity.client.js';
import {
  computeRequestHash,
  evaluateVerdict,
  type IntegrityAction,
  type IntegrityVerdict,
} from './verdict.js';

export type VerifyIntegrityParams = {
  action: IntegrityAction;
  /** The nonce the app got from GET /api/integrity/nonce and hashed into the request. */
  nonce: string;
  /** The Play Integrity (Standard) token. Never logged. */
  token: string;
  /** The normalised email that went into the request hash. */
  email: string;
};

@Injectable()
export class IntegrityService implements OnModuleInit {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(NonceStore) private readonly nonces: NonceStore,
    @Inject(PLAY_INTEGRITY_CLIENT) private readonly client: PlayIntegrityClient,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    if (this.config.get('INTEGRITY_MODE') === 'bypass') {
      // Loud on purpose: this must never be the mode of a real environment (the config refuses it
      // in production).
      this.logger.warn('INTEGRITY_MODE=bypass: Play Integrity is NOT checked (local development)');
    }
  }

  /**
   * The verdict for one register/login request: `{ ok, reasons[] }`.
   *
   * The nonce is consumed FIRST, whatever happens next, so a token can be presented once: an
   * unknown, expired or replayed nonce fails here without calling Google. (So after a
   * `503 integrity_unavailable` the app fetches a new nonce and a new token.)
   *
   * In `bypass` mode the token is not looked at, but a valid single-use nonce is still required, so
   * the local flow has the same shape as production.
   *
   * Throws `503 integrity_unavailable` when Google cannot be reached (fail closed).
   */
  async verify(params: VerifyIntegrityParams): Promise<IntegrityVerdict> {
    if (!(await this.nonces.consume(params.nonce))) {
      return { ok: false, reasons: ['nonce_invalid'] };
    }
    if (this.config.get('INTEGRITY_MODE') === 'bypass') {
      return { ok: true, reasons: [] };
    }

    const decoded = await this.client.decode(params.token);
    if (decoded.kind === 'rejected') {
      return { ok: false, reasons: ['token_invalid'] };
    }

    return evaluateVerdict({
      payload: decoded.payload,
      expectedPackageName: this.config.get('INTEGRITY_PACKAGE_NAME') ?? '',
      trustedCertDigests: this.config.get('INTEGRITY_CERT_SHA256'),
      expectedRequestHash: computeRequestHash(params.action, params.nonce, params.email),
      nowMs: Date.now(),
    });
  }

  /**
   * Policy (rule 9, brief §5): register and login REQUIRE an acceptable verdict. Anything else is a
   * `403 integrity_failed` with a generic message; the reasons go to the audit log only.
   */
  async require(params: VerifyIntegrityParams): Promise<void> {
    const verdict = await this.verify(params);
    if (!verdict.ok) {
      this.audit.record('integrity_failed', { action: params.action, reasons: verdict.reasons });
      throw AppException.integrityFailed();
    }
  }
}
