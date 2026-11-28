import { createPrivateKey, createPublicKey, randomUUID, type KeyObject } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { SignJWT, jwtVerify, type JWTHeaderParameters } from 'jose';
import { z } from 'zod';
import { ConfigService } from '../../common/config/config.service.js';
import { AppException } from '../../common/errors/app.exception.js';
import type { Actor } from '../../common/guards/actor.js';

export const JWT_ISSUER = 'https://api.mobiledesk.app';
export const JWT_AUDIENCE = 'mobiledesk-app';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const CLOCK_TOLERANCE_SECONDS = 30;
/** A real token is about 300 characters; refuse anything absurd before parsing it. */
const MAX_TOKEN_LENGTH = 2_048;

const claimsSchema = z.object({
  sub: z.uuid(),
  // The device the token is bound to; null until the device is registered (Phase 3).
  did: z.uuid().nullable(),
  jti: z.string().min(1),
});

/**
 * Signs and verifies access tokens: EdDSA (Ed25519) JWTs, 15 minutes.
 *
 * Several keys can be loaded at once (`kid -> key`): new tokens are signed with JWT_ACTIVE_KID,
 * old tokens stay valid until they expire as long as their key is still listed. That is the whole
 * key-rotation mechanism (docs/RUNBOOKS.md).
 */
@Injectable()
export class AccessTokenService implements OnModuleInit {
  private signingKey!: KeyObject;
  private activeKid!: string;
  private readonly publicKeys = new Map<string, KeyObject>();

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.activeKid = this.config.get('JWT_ACTIVE_KID');
    for (const [kid, pem] of Object.entries(this.config.get('JWT_PRIVATE_KEYS'))) {
      const privateKey = createPrivateKey(pem);
      // Only the public half is kept for verification; the private key is held for signing only
      // when it is the active one.
      this.publicKeys.set(kid, createPublicKey(privateKey));
      if (kid === this.activeKid) this.signingKey = privateKey;
    }
  }

  async sign(userId: string, deviceId: string | null): Promise<string> {
    return new SignJWT({ did: deviceId })
      .setProtectedHeader({ alg: 'EdDSA', kid: this.activeKid })
      .setSubject(userId)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
      .setJti(randomUUID())
      .sign(this.signingKey);
  }

  /**
   * The identity a valid token stands for. Anything wrong with the token (shape, algorithm, key id,
   * signature, issuer, audience, expiry, claims) is the same `401 unauthorized`: the response never
   * says which check failed.
   */
  async verify(token: string): Promise<Actor> {
    if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) throw AppException.unauthorized();
    try {
      const { payload } = await jwtVerify(token, (header) => this.keyFor(header), {
        // Only EdDSA: "none", HS256 and everything else are rejected before the key is used.
        algorithms: ['EdDSA'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        requiredClaims: ['sub', 'exp', 'iat', 'jti'],
      });
      const claims = claimsSchema.parse(payload);
      return { userId: claims.sub, deviceId: claims.did };
    } catch {
      throw AppException.unauthorized();
    }
  }

  private keyFor(header: JWTHeaderParameters): KeyObject {
    const key = header.kid === undefined ? undefined : this.publicKeys.get(header.kid);
    if (key === undefined) throw new Error('unknown key id');
    return key;
  }
}
